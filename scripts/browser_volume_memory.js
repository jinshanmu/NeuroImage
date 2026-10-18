async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Notebook scene restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await page.reload(); await ready();
  const contrast = page.getByLabel('MRI contrast', {exact:true});
  const options = await contrast.locator('option').evaluateAll(items => items.map(item => item.value));
  assert(options.length === 2, 'This resource fixture requires the two original brainstem MRI contrasts.');
  const initial = await contrast.inputValue();
  const other = options.find(value => value !== initial);
  const coordinates = () => Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const position = await coordinates();
  const frame = () => page.locator('canvas').evaluate(canvas => canvas.toDataURL());
  const pixels = await frame();
  const cdp = await page.context().newCDPSession(page);
  const sample = async switches => {
    await cdp.send('HeapProfiler.collectGarbage');
    const memory = await cdp.send('Runtime.getHeapUsage');
    return {switches, ...memory};
  };
  const samples = [await sample(0)];
  for (let i = 1; i <= 24; i++) {
    await contrast.selectOption(i % 2 ? other : initial); await ready();
    assert(JSON.stringify(await coordinates()) === JSON.stringify(position), 'A contrast switch moved the source point.');
    if (i % 4 === 0) samples.push(await sample(i));
  }
  const restoredPixelsIdentical = pixels === await frame();
  await cdp.detach();
  assert(restoredPixelsIdentical, 'Returning to the original contrast did not reproduce its complete canvas.');
  assert(!errors.length, 'Contrast switching produced browser errors.');
  const backingGrowth = samples.at(-1).backingStorageSize - samples[1].backingStorageSize;
  assert(backingGrowth < 8 * 1024 * 1024, 'Repeated background changes retain more than 8 MiB of additional backing storage after warmup.');
  return {status:'passed', method:'Chromium CDP heap and ArrayBuffer backing storage after explicit garbage collection; excludes GPU textures and driver allocations.', switches:24, position_ras_mm:position, restored_pixels_identical:restoredPixelsIdentical, retained_backing_growth_after_warmup_bytes:backingGrowth, samples, errors};
}
