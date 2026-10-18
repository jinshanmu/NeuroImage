async page => {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(String(error)));
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:60000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const coordinates = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const screenshot = async name => {
    await page.locator('.workspace-heading h1').click(); await ready();
    await page.locator('canvas').screenshot({path:'output/playwright/spatial-' + name + '.png'});
  };
  const opacity = async () => {
    await page.getByText('Selected surface display', {exact:true}).click();
    const input = page.getByLabel('Selected surface opacity', {exact:true});
    await input.focus(); await input.press('Home');
    for (let i = 0; i < 5; i++) await input.press('ArrowRight');
    assert(Number(await input.inputValue()) === .25, 'Actual opacity keyboard input failed');
    await ready();
  };
  const guides = async enabled => {
    const summary = page.locator('.section-guide-controls > summary');
    await summary.click();
    for (const plane of ['axial','coronal','sagittal']) await page.getByLabel('Show ' + plane + ' guide', {exact:true}).setChecked(enabled);
    await summary.click(); await ready();
  };
  await page.reload(); await ready();
  const catalog = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases);
  const results = [];
  for (const [dataset, selected] of [['spl_nac','spl_nac:label:12'], ['mida','mida:label:14'], ['cit168_native','cit168_native:label:2']]) {
    const atlas = catalog.find(entry => entry.dataset_id === dataset);
    assert(atlas, 'Serve all three native-space fixtures before running spatial acceptance.');
    await page.getByLabel('Local atlas', {exact:true}).selectOption(atlas.key); await ready();
    await page.getByRole('button', {name:'Reset view',exact:true}).click(); await ready();
    await page.locator('button[title="' + selected + '"]').click(); await ready();
    await page.getByRole('button', {name:'Isolate selected',exact:true}).click(); await ready();
    if (dataset === 'cit168_native') await page.waitForFunction(() => /^\d\.\d{4}$/.test(document.querySelector('output[aria-label="Source probability at cursor"]')?.textContent ?? ''));
    const position = await coordinates();
    await page.getByLabel('View layout', {exact:true}).selectOption('axial'); await ready();
    await screenshot(dataset + '-slice-before');
    await opacity(); await screenshot(dataset + '-slice-opacity');
    await guides(true); await screenshot(dataset + '-slice-guides');
    await page.getByLabel('View layout', {exact:true}).selectOption('quad'); await ready();
    await guides(false); await screenshot(dataset + '-quad-opacity');
    const slider = page.getByLabel('Selected surface opacity', {exact:true});
    await slider.focus(); await slider.press('End'); await ready();
    await screenshot(dataset + '-quad-opaque');
    await slider.focus(); await slider.press('Home');
    for (let i = 0; i < 5; i++) await slider.press('ArrowRight');
    await guides(true); await screenshot(dataset + '-quad-guides');
    assert(JSON.stringify(await coordinates()) === JSON.stringify(position), 'Display controls moved the physical cursor');
    const savedKey = 'neuroimage:scene:' + atlas.key;
    const existing = await page.evaluate(key => localStorage.getItem(key), savedKey);
    assert(!existing || JSON.parse(existing).state.note === 'Spatial display acceptance fixture.', 'Use an isolated browser profile; existing user scene retained.');
    await page.getByLabel('Scene teaching notes').fill('Spatial display acceptance fixture.');
    await page.getByRole('button', {name:'Save scene',exact:true}).click();
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key) || 'null')?.state?.sectionPlanes?.length === 3, savedKey);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), savedKey);
    assert(saved.state.surfaceOpacity[selected] === .25, 'Individual opacity was not captured');
    await screenshot(dataset + '-saved');
    const file = 'data/exports/' + dataset + '/spatial-validation/spatial-scene.json';
    const download = page.waitForEvent('download'); await page.getByRole('button', {name:'Export scene',exact:true}).click();
    await (await download).saveAs(file);
    await page.getByRole('button', {name:'Reset view',exact:true}).click(); await ready();
    await page.getByRole('button', {name:'Restore saved',exact:true}).click(); await ready();
    await screenshot(dataset + '-restored');
    await page.reload(); await ready();
    await page.getByLabel('Local atlas', {exact:true}).selectOption(atlas.key); await ready();
    await page.getByLabel('Import scene file', {exact:true}).setInputFiles(file); await ready();
    await screenshot(dataset + '-imported');
    const image = page.waitForEvent('download'); await page.getByRole('button', {name:'Export teaching image',exact:true}).click();
    await (await image).saveAs('data/exports/' + dataset + '/spatial-validation/spatial-teaching.zip');
    await page.getByRole('button', {name:'Inspect',exact:true}).click();
    await page.getByLabel('Anatomy category', {exact:true}).selectOption(dataset === 'mida' ? 'Brainstem' : 'Deep structures');
    const ids = await page.locator('.structure-list button[title]').evaluateAll(buttons => buttons.map(button => button.title));
    await page.getByRole('button', {name:'Show matches',exact:true}).click(); await ready();
    const shown = await page.locator('.structure-list input[type=checkbox]').evaluateAll(inputs => inputs.every(input => input.checked));
    assert(shown && ids.length > 0, 'Category selection did not show all source-defined matches');
    await page.getByRole('button', {name:'Hide matches',exact:true}).click(); await ready();
    assert(await page.locator('.structure-list input[type=checkbox]').evaluateAll(inputs => inputs.every(input => !input.checked)), 'Hide matches left source regions enabled');
    results.push({dataset_id:dataset,package_version:atlas.package_version,selected,position_ras_mm:position,opacity:.25,section_planes:saved.state.sectionPlanes,category_matches:ids.length});
  }
  const graphics = await page.locator('canvas').evaluate(canvas => {
    const gl = canvas.getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {renderer:debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), error:gl.getError()};
  });
  assert(!errors.length && !external.length && graphics.error === 0, 'Browser errors or nonlocal requests: ' + JSON.stringify({errors,external,graphics}));
  return {status:'passed',fixtures:results,graphics,page_errors:errors,external_requests:external,scope:'Engineering display, source position, saved scene and category controls; independent pixel and source checks are required.'};
}
