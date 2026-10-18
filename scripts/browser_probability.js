async page => {
  const errors = [], external = [], probes = [];
  page.on('pageerror', error => errors.push(String(error)));
  const origin = new URL(page.url()).origin;
  await page.unroute('**/*');
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const ready = () => page.waitForFunction(() => document.querySelector('.live-status')?.textContent?.startsWith('Ready'), null, { timeout: 60000 });
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const catalog = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases);
  const atlas = catalog.find(a => a.dataset_id === 'cit168_native');
  assert(atlas, 'Serve the local CIT168 probability package before this check.');
  const manifest = await page.evaluate(async url => (await fetch(url)).json(), atlas.manifest_url);
  await page.getByLabel('Local atlas', { exact: true }).selectOption(atlas.key);
  await ready();
  await page.getByRole('button', { name: 'Reset view', exact: true }).click();
  await ready();
  assert(await page.getByLabel('Evidence overlay').inputValue() === 'probability', 'Source probability evidence must be the default.');
  const readout = page.getByLabel('Source probability at cursor');
  const position = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  async function choose(structure) {
    await page.locator('button[title="' + structure.id + '"]').click();
    await page.waitForFunction(() => /^\d\.\d{4}$/.test(document.querySelector('output[aria-label="Source probability at cursor"]')?.textContent ?? ''), null, { timeout: 60000 });
    await ready(); await frame();
  }
  async function sample(structure, test) {
    // Contrast changes reload the image and channel asynchronously. A prior
    // Ready status may still be visible before that effect starts.
    await page.waitForFunction(() => /^\d\.\d{4}$/.test(document.querySelector('output[aria-label="Source probability at cursor"]')?.textContent ?? ''), null, { timeout: 60000 });
    await ready(); await frame();
    const value = Number(await readout.textContent());
    assert(Number.isFinite(value), 'The probability channel has not finished loading.');
    probes.push({ structure_id: structure.id, source_channel: structure.probability.source_channel, test,
      position_ras_mm: await position(), displayed_support: value });
  }
  for (const structure of manifest.structures) {
    await choose(structure); await sample(structure, 'source target');
    const target = await position();
    // Sampling another coordinate does not infer mirrored anatomy or correspondence.
    await page.getByLabel('R coordinate in millimeters').fill(String(-target[0]));
    await ready(); await frame(); await sample(structure, 'opposite R coordinate; independent sample');
    assert((await page.locator('.coordinate-status').textContent()) === structure.name, 'Cursor sampling unexpectedly switched the selected channel.');
    await page.getByLabel('R coordinate in millimeters').fill('300');
    await ready(); await frame();
    assert((await readout.textContent()) === 'Unavailable at cursor', 'Outside-volume samples must not be reported as zero support.');
  }
  const target = manifest.structures.find(s => s.source_name === 'SNc');
  await choose(target);
  const initial = await position();
  for (let offset = -5; offset <= 5; offset++) {
    await page.getByLabel('R coordinate in millimeters').fill(String(Number((initial[0] + offset * .7).toFixed(2))));
    await ready(); await frame(); await sample(target, 'nearby native-grid sample');
  }
  await choose(target);
  await page.getByRole('button', { name: 'Isolate selected', exact: true }).click();
  await page.getByLabel('View layout', { exact: true }).selectOption('axial');
  await ready(); await frame();
  await page.locator('canvas').screenshot({ path: 'output/playwright/probability-visible.png' });
  await page.getByLabel('Surface opacity', { exact: true }).press('Home');
  await ready(); await frame();
  await page.locator('canvas').screenshot({ path: 'output/playwright/probability-no-surface.png' });
  await page.getByLabel('Label opacity', { exact: true }).press('Home');
  await ready(); await frame();
  await page.locator('canvas').screenshot({ path: 'output/playwright/probability-transparent.png' });
  await page.getByLabel('Label opacity', { exact: true }).press('End');
  await page.getByLabel('Surface opacity', { exact: true }).press('End');
  await page.getByLabel('View layout', { exact: true }).selectOption('quad');
  await ready();
  const beforeContrast = await position();
  await page.getByLabel('MRI contrast', { exact: true }).selectOption('t2');
  await ready(); await frame();
  assert((await position()).every((v, i) => v === beforeContrast[i]), 'Changing MRI contrast changed physical coordinates.');
  await sample(target, 'same probability with T2 contrast');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await page.getByLabel('Evidence overlay').selectOption('labels');
  await ready();
  assert(await readout.count() === 0, 'A probability sample remains visible in categorical mode.');
  await page.getByRole('button', { name: 'Restore saved', exact: true }).click();
  await ready(); await frame();
  assert(await page.getByLabel('Evidence overlay').inputValue() === 'probability', 'Scene restoration lost the evidence mode.');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export teaching image', exact: true }).click();
  await (await downloaded).saveAs('data/exports/cit168_native/browser-validation/probability-teaching.zip');
  await page.getByRole('button', { name: 'Learn', exact: true }).click();
  await page.getByLabel('Lesson', { exact: true }).selectOption('NI-P003');
  await ready();
  await page.getByLabel('Identification practice', { exact: true }).check();
  assert(!(await page.locator('.probability-evidence').textContent()).includes('Red nucleus'), 'Unrevealed practice exposes its target name.');
  await page.getByRole('button', { name: 'Reveal and compare', exact: true }).click();
  assert((await page.locator('.answer').textContent()).includes('Red nucleus'), 'Probability lesson feedback has the wrong target.');
  await page.getByLabel('Identification practice', { exact: true }).uncheck();
  await ready(); await frame();
  await page.screenshot({ path: 'output/playwright/probability-teaching-validated.png' });
  assert(!errors.length && !external.length, 'Browser errors or unexpected external requests occurred.');
  return { status: 'passed', package_version: manifest.package_version, structures: manifest.structures.length,
    probability_channels: manifest.volumes.filter(v => v.kind === 'probability').length, probes,
    checks: ['default probability evidence', 'all channels loaded on demand', 'independent samples on both sides', 'fixed channel during cursor movement', 'outside-volume unavailable value', 'T1/T2 position agreement', 'evidence-mode scene recovery', 'credited probability export', 'source-grounded lesson and practice'],
    page_errors: errors, external_requests: external };
}
