async page => {
  const errors = [], probes = [], samples = [];
  page.on('pageerror', error => errors.push(String(error)));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const ready = async () => { await page.waitForFunction(() => /^(Ready|Notebook scene restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000}); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  await page.reload();
  await page.waitForFunction(() => !!document.querySelector('.live-status') || !!document.querySelector('.workspace-manager'));
  if (await page.getByRole('region',{name:'Local data workspace',exact:true}).isVisible()) await page.getByRole('button',{name:'Back to atlas',exact:true}).click();
  await ready();
  const {atlas,manifest} = await page.evaluate(async () => {
    const atlas = (await (await fetch('/api/atlases')).json()).atlases.find(item => item.dataset_id === 'brainstem_navigator_mni' && item.structures === 86);
    if (!atlas) throw new Error('Open the expanded 86-field Brainstem Navigator package before this fixture.');
    return {atlas,manifest:await (await fetch(atlas.manifest_url)).json()};
  });
  await page.getByLabel('Local atlas',{exact:true}).selectOption(atlas.key); await ready();
  await page.getByRole('button',{name:'Reset view',exact:true}).click(); await ready();
  const cdp = await page.context().newCDPSession(page);
  const sample = async visited => { await cdp.send('HeapProfiler.collectGarbage'); samples.push({visited,...await cdp.send('Runtime.getHeapUsage')}); };
  await sample(0);
  for (const structure of manifest.structures) {
    await page.locator('button[title="' + structure.id + '"]').click(); await ready();
    await page.getByRole('button',{name:'Isolate selected',exact:true}).click(); await ready();
    const value = Number(await page.getByLabel('Source probability at cursor',{exact:true}).textContent());
    const position = await Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
    assert(Number.isFinite(value) && value >= .34995 && value <= 1, 'A source mask target has unavailable or inconsistent probability.');
    assert(position.every((value,axis)=>Math.abs(value-structure.target_ras_mm[axis])<.011), 'A field opened at the wrong source point.');
    assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue())===1, 'Catalogue browsing lost the complete available source sections.');
    probes.push({structure_id:structure.id,source_name:structure.source_name,position_ras_mm:position,displayed_probability:value});
    if (probes.length % 16 === 0) await sample(probes.length);
  }
  await sample(probes.length); await cdp.detach();
  const growth = samples.at(-1).backingStorageSize - samples[0].backingStorageSize;
  assert(growth < 16 * 1024 * 1024, 'Browsing all source fields retained more than 16 MiB of additional image backing storage.');
  assert(!errors.length, 'The expanded field catalogue produced browser errors.');
  return {status:'passed',package_version:manifest.package_version,fields_visited:probes.length,probes,samples,retained_backing_growth_bytes:growth,measurement:'Chromium CDP heap and backing storage after explicit garbage collection; GPU textures and driver memory excluded.',page_errors:errors};
}
