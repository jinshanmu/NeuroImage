async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
  const ready = async () => {
    await page.waitForFunction(() => !!document.querySelector('.canvas-shell[data-ready="true"]') ||
      !!document.querySelector('[role=alert],.load-error'), null, {timeout:120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.locator('[role=alert],.load-error').count() === 0,
      'A viewer error is visible: ' + (await page.locator('[role=alert],.load-error').allTextContents()).join(' · '));
    assert(await page.locator('.canvas-shell[data-ready="true"]').count() === 1, 'The source canvas did not become ready.');
    assert(await page.locator('.cursor-readout .coordinate-status').count() === 1 &&
      await page.locator('.coordinate-status').count() === 1 && await page.locator('.compact-selection').count() === 0,
      'The responsive image workspace duplicated its cursor name.');
    assert(JSON.stringify(await page.locator('.view-coordinate-bar').evaluate(bar => Array.from(bar.children).map(child =>
      child.matches('.view-settings') ? 'settings' : child.matches('.coordinate-bar') ? 'coordinates' :
        child.matches('button.reset-view') ? 'reset' : 'unexpected'))) === JSON.stringify(['settings', 'coordinates', 'reset']),
      'Responsive image settings, RAS and Reset view lost their order.');
    assert(await page.getByRole('button', {name:/^(Expand viewer|Exit expanded view)$/}).count() === 0,
      'The formal viewer still exposes an expanded-view action.');
    assert(await page.getByRole('dialog', {name:'Expanded atlas viewer',exact:true}).count() === 0 &&
      await page.locator('.workspace.expanded').count() === 0, 'The formal viewer retained an expanded-view mode.');
    const layouts = page.getByLabel('View layout', {exact: true});
    assert(JSON.stringify(await layouts.locator('option').evaluateAll(options => options.map(option => option.value))) ===
      JSON.stringify(['quad', 'axial', 'coronal', 'sagittal', '3d']), 'The formal layout choices lost a supported view or retained the retired equal layout.');
    assert(await layouts.locator('option').filter({hasText:'Equal 2D + 3D'}).count() === 0, 'The retired equal layout remains selectable.');
  };
  const position = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  await ready();
  const initial = await position(), source = await page.getByLabel('Source', {exact: true}).inputValue();
  assert(source === 'julich_selected-53ec2653119db4ba' && JSON.stringify(initial) === '[-28,-29,-15]', 'Open the preserved left CA1 review scene before this source-specific framing check.');
  const captures = [], headerChecks = [];
  for (const viewport of [{width: 1600, height: 1050}, {width: 1250, height: 900}, {width: 1100, height: 900}, {width: 900, height: 800}]) {
    await page.setViewportSize(viewport);
    await ready();
    const header = await page.evaluate(() => {
      const choice = document.querySelector('.app-header .dataset-picker select');
      const comparison = Array.from(document.querySelectorAll('.app-header .check-control')).find(node => node.textContent.includes('Compare sources'));
      const a = choice.getBoundingClientRect(), b = comparison.getBoundingClientRect();
      return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        source_width: a.width, source_right: a.right, comparison_right: b.right};
    });
    assert(header.scrollWidth <= viewport.width + 1 && header.source_right <= viewport.width && header.comparison_right <= viewport.width, 'A source or comparison control overflows the window.');
    assert(header.source_width >= 120, 'The source selector became too narrow to operate.');
    headerChecks.push({viewport, ...header});
    if (viewport.width > 1100) continue;
    for (const {layout, panels} of [{layout:'quad',panels:'auto'}, {layout:'quad',panels:'grid'}, {layout:'quad',panels:'row'}, {layout:'3d'}]) {
      await page.getByLabel('View layout', {exact: true}).selectOption(layout);
      await ready();
      if (panels) {
        await page.getByLabel('Image panel arrangement', {exact: true}).selectOption(panels);
        await ready();
      }
      assert(JSON.stringify(await position()) === JSON.stringify(initial), 'Resizing or changing layout moved the native source point.');
      const canvas = await page.locator('.canvas-shell canvas').boundingBox();
      assert(canvas.width >= viewport.width - 60 && canvas.height >= 450, 'Responsive source viewing lost its usable canvas area.');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      assert(JSON.stringify(await position()) === JSON.stringify(initial), 'Page scrolling moved the native source point.');
      await page.evaluate(() => window.scrollTo(0, 0));
      const capture = 'data/benchmarks/julich_selected/responsive-layout/' + viewport.width + '-' + layout + (panels ? '-' + panels : '') + '.png';
      await page.screenshot({path: capture, fullPage: false});
      captures.push({viewport, layout, panels:panels ?? null, canvas, capture});
    }
  }
  const renderer = await page.locator('.canvas-shell canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
  });
  await page.setViewportSize({width: 1600, height: 1050});
  await page.getByLabel('View layout', {exact: true}).selectOption('quad');
  await ready();
  await page.getByLabel('Image panel arrangement', {exact: true}).selectOption('auto');
  await ready();
  page.off('pageerror', onError);
  await page.unroute('**/*');
  assert(!errors.length && !external.length, errors.concat(external).join('\n'));
  return {status: 'passed', source, initial, header_checks: headerChecks, captures, renderer,
    page_errors: errors, external_requests: external, checks: ['Source and comparison controls remain inside four tested window widths', 'Automatic, grid, row and 3D layouts retain the exact native point while resizing and scrolling', 'Ordinary four-view and 3D layouts retain usable canvas area without equal or expanded-view modes']};
}
