async page => {
  const assert = (value, message) => { if (!value) throw Error(message); };
  assert(page.viewportSize() === null, 'Run this check in a headed browser context with viewport: null.');
  const session = await page.context().newCDPSession(page);
  const original = await session.send('Browser.getWindowForTarget');
  const errors = [], onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const position = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue()));
  const inspect = async mode => {
    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector('.canvas-shell canvas'), ancestors = [];
      for (let element = canvas.parentElement; element && element !== document.body; element = element.parentElement) {
        if (/^(auto|scroll)$/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight + 1) ancestors.push(element.className);
      }
      const selectors = '.app-header,.app-header>*,.workspace,.viewer-column,.canvas-shell,.catalog.drawer-open,.inspector.drawer-open';
      const outside = [...document.querySelectorAll(selectors)].filter(element => {
        const box = element.getBoundingClientRect();
        return box.width && (box.left < -.5 || box.right > document.documentElement.clientWidth + .5);
      }).map(element => element.className);
      return {viewport: [innerWidth, innerHeight], outer: [outerWidth, outerHeight], document_width: document.documentElement.clientWidth,
        scroll_width: document.documentElement.scrollWidth, canvas: canvas.getBoundingClientRect().toJSON(),
        nested_page_scrollers: ancestors, outside, body_overflow: getComputedStyle(document.body).overflowY};
    });
    assert(!geometry.outside.length && geometry.scroll_width <= geometry.document_width + 1, 'A page edge or drawer exceeds the browser width: ' + JSON.stringify(geometry));
    assert(!geometry.nested_page_scrollers.length && geometry.body_overflow !== 'hidden', 'The atlas has an additional page scrollbar: ' + JSON.stringify(geometry));
    assert(JSON.stringify(await position()) === JSON.stringify(initial), 'Window layout changed the native source point.');
    return {mode, ...geometry};
  };
  let initial;
  try {
    await ready(); initial = await position();
    const exit = page.getByRole('button', {name: 'Exit expanded view', exact: true});
    if (await exit.isVisible()) await exit.click();
    for (const name of ['Close structure library', 'Close learning tools']) {
      const close = page.getByRole('button', {name, exact: true});
      if (await close.isVisible()) await close.click();
    }
    await session.send('Browser.setWindowBounds', {windowId: original.windowId, bounds: {windowState: 'normal'}});
    const checks = [];
    for (const width of [1500, 960]) {
      await session.send('Browser.setWindowBounds', {windowId: original.windowId, bounds: {width, height: 980}});
      await page.waitForFunction(expected => Math.abs(outerWidth - expected) < 8 && Math.abs(outerWidth - innerWidth) < 100, width);
      await ready(); await page.evaluate(() => window.scrollTo(0, 0));
      checks.push(await inspect('ordinary'));
      for (const name of ['Structure library', 'Learning tools']) {
        const toggle = page.getByRole('button', {name, exact: true});
        await toggle.click(); await ready();
        checks.push(await inspect(name));
        await page.getByRole('button', {name: name === 'Structure library' ? 'Close structure library' : 'Close learning tools', exact: true}).click(); await ready();
      }
      await page.getByRole('button', {name: 'Expand viewer', exact: true}).click(); await ready();
      checks.push(await inspect('expanded'));
      const scrolling = await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
        return {offset: scrollY, maximum: document.documentElement.scrollHeight - innerHeight, viewer_offset: document.querySelector('.viewer-column').scrollTop};
      });
      assert(scrolling.maximum <= 1 || scrolling.offset > 0, 'The browser cannot scroll to the lower atlas controls.');
      assert(scrolling.viewer_offset === 0, 'The viewer created a second page scroll position.');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({path: 'data/benchmarks/julich_selected/right-3d-layout-20261014/native-window-' + width + '.png'});
      checks.push({mode: 'browser_scroll', ...scrolling});
      await page.getByRole('button', {name: 'Exit expanded view', exact: true}).click(); await ready();
    }
    const ordinary = checks.filter(check => check.mode === 'ordinary');
    assert(ordinary[0].viewport[0] - ordinary[1].viewport[0] > 300 && ordinary[0].canvas.width - ordinary[1].canvas.width > 300, 'The live page did not follow the real browser window: ' + JSON.stringify(ordinary));
    assert(!errors.length, errors.join('\n'));
    return {status: 'passed', native_window_resize: true, initial, checks, page_errors: errors};
  } finally {
    page.off('pageerror', onError);
    await session.send('Browser.setWindowBounds', {windowId: original.windowId, bounds: original.bounds});
    await session.detach();
  }
}
