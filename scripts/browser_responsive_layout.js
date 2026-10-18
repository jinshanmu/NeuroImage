async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const position = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  await ready();
  const initial = await position(), source = await page.getByLabel('Source', {exact: true}).inputValue();
  assert(source === 'julich_selected-53ec2653119db4ba' && JSON.stringify(initial) === '[-28,-29,-15]', 'Open the preserved left CA1 review scene before this source-specific framing check.');
  const captures = [], headerChecks = [];
  for (const viewport of [{width: 1600, height: 1050}, {width: 1250, height: 900}, {width: 1100, height: 900}, {width: 900, height: 800}]) {
    const exit = page.getByRole('button', {name: 'Exit expanded view', exact: true});
    if (await exit.isVisible()) await exit.click();
    await page.setViewportSize(viewport);
    await ready();
    const header = await page.evaluate(() => {
      const choice = document.querySelector('.app-header .dataset-picker select');
      const comparison = Array.from(document.querySelectorAll('.app-header .check-control')).find(node => node.textContent.includes('Compare native spaces'));
      const a = choice.getBoundingClientRect(), b = comparison.getBoundingClientRect();
      return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        source_width: a.width, source_right: a.right, comparison_right: b.right};
    });
    assert(header.scrollWidth <= viewport.width + 1 && header.source_right <= viewport.width && header.comparison_right <= viewport.width, 'A source or comparison control overflows the window.');
    assert(header.source_width >= 120, 'The source selector became too narrow to operate.');
    headerChecks.push({viewport, ...header});
    if (viewport.width > 1100) continue;
    await page.getByRole('button', {name: 'Expand viewer', exact: true}).click();
    for (const layout of ['anatomy', '3d']) {
      await page.getByLabel('View layout', {exact: true}).selectOption(layout);
      await ready();
      assert(JSON.stringify(await position()) === JSON.stringify(initial), 'Resizing or changing layout moved the native source point.');
      const canvas = await page.locator('.canvas-shell canvas').boundingBox();
      assert(canvas.width >= viewport.width - 60 && canvas.height >= 450, 'Expanded source viewing lost its usable canvas area.');
      const capture = 'data/benchmarks/julich_selected/responsive-layout/' + viewport.width + '-' + layout + '.png';
      await page.screenshot({path: capture, fullPage: false});
      captures.push({viewport, layout, canvas, capture});
    }
  }
  const renderer = await page.locator('.canvas-shell canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
  });
  await page.setViewportSize({width: 1600, height: 1050});
  await page.getByLabel('View layout', {exact: true}).selectOption('anatomy');
  await ready();
  page.off('pageerror', onError);
  await page.unroute('**/*');
  assert(!errors.length && !external.length, errors.concat(external).join('\n'));
  return {status: 'passed', source, initial, header_checks: headerChecks, captures, renderer,
    page_errors: errors, external_requests: external, checks: ['Source and comparison controls remain inside four tested window widths', 'Two narrower expanded layouts retain the exact native point', 'Large 3D and three original image planes retain usable canvas area']};
}
