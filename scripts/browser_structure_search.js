async page => {
  // Development-branch reference for the former Local atlases / Data and builds panel.
  // This historical workflow is not formal acceptance for the current atlas browser.
  const origin = new URL(page.url()).origin, errors = [], external = [], opened = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const retiredDatasets = ['ixi_mra','hba_native','mesoveins','venat','mouches_arteries'];
  const tag = new URL(page.url()).searchParams.get('acceptance-output') ?? 'development';
  assert(/^[a-z0-9-]{1,48}$/.test(tag), 'Use a filename-safe acceptance tag.');
  page.on('pageerror', error => errors.push(String(error)));
  await page.unroute('**/*');
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  await page.setViewportSize({width:1600,height:1120});
  await page.goto(origin); await page.getByRole('button',{name:'Local atlases',exact:true}).click();
  const search = page.getByRole('region',{name:'Search local anatomy'});
  const query = async (text, action) => {
    const pending = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.origin === origin && url.pathname === '/api/workspace/structures' && url.searchParams.get('q') === text;
    });
    if (action) await action(); else await page.getByLabel('Search all local structures',{exact:true}).fill(text);
    const response = await pending; assert(response.ok(), 'The structure search failed.');
    const result = await response.json();
    await search.getByRole('status').filter({hasText:result.total ? 'source matches' : 'No source structures'}).waitFor();
    return result;
  };
  const broad = await query('left');
  assert(broad.total > 100 && broad.matches.length === 100, 'The fixture must exercise bounded search pagination.');
  const next = await query('left', () => page.getByRole('button',{name:'Next matches',exact:true}).click());
  assert(next.offset === 100 && next.total === broad.total, 'The next result page lost its source count.');
  const ids = new Set(broad.matches.map(item => item.atlas_key + ':' + item.structure_id));
  assert(next.matches.every(item => !ids.has(item.atlas_key + ':' + item.structure_id)), 'Search pages repeat source entries.');
  const filters = page.getByLabel('Workspace dataset filter');
  assert(await filters.locator('option').evaluateAll((options, retired) =>
    options.every(option => !retired.includes(option.value)), retiredDatasets),
    'Structure search still offers a retired source.');
  assert([...broad.matches,...next.matches].every(item => !retiredDatasets.includes(item.dataset_id)),
    'Structure search exposes a retired source package.');
  const filtered = await query('left', () => filters.selectOption('inner_ear_ct_specimen1'));
  assert(filtered.offset === 0 && filtered.matches.every(item => item.dataset_id === 'inner_ear_ct_specimen1'),
    'A retained source filter acquired unrelated structures or retained an invalid result page.');
  await query('left', () => page.getByLabel('Workspace dataset filter').selectOption(''));
  const repeated = await query('trigeminal');
  const nerves = repeated.matches.filter(item => item.dataset_id === 'mida');
  assert(nerves.length >= 2 && new Set(nerves.map(item => item.package_version)).size === nerves.length, 'Historical source definitions were merged.');
  await page.screenshot({path:'output/playwright/structure-search-results-' + tag + '.png'});
  const fixtures = [
    {query:'trigeminal',dataset:'mida',version:'3374505761bc6543'},
    {query:'CNIII_L',dataset:'hcp1065_tracts',version:'d646e779e4d93dce'},
    {query:'RN_l',dataset:'brainstem_navigator_mni',version:'f753cbca5de01ac4'},
    {query:'left putamen',dataset:'cerebra',version:'41f2dadc334622e8'},
  ];
  const position = () => Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const ready = async () => { await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000}); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
  for (let index=0;index<fixtures.length;index++) {
    const fixture = fixtures[index];
    if (index) { await page.getByRole('button',{name:'Data and builds',exact:true}).click(); await page.getByRole('button',{name:'Local atlases',exact:true}).click(); }
    const result = index ? await query(fixture.query) : repeated;
    const matches = result.matches.filter(item => item.dataset_id === fixture.dataset && item.package_version === fixture.version);
    assert(matches.length === 1, 'The fixture requires one exact source target: ' + fixture.query);
    const match = matches[0];
    const item = search.getByRole('listitem',{name:match.name + ' · ' + match.dataset_id + ' · ' + match.package_version,exact:true});
    await item.getByRole('button',{name:'Open structure',exact:true}).click(); await ready();
    const source = await page.evaluate(async key => {
      const atlas = (await (await fetch('/api/atlases')).json()).atlases.find(item => item.key === key);
      return {atlas,manifest:await (await fetch(atlas.manifest_url)).json()};
    }, match.atlas_key);
    const structure = source.manifest.structures.find(item => item.id === match.structure_id), actual = await position();
    assert(source.manifest.package_version === match.package_version, 'Search opened another source version.');
    assert(actual.every((value,axis) => Math.abs(value - structure.target_ras_mm[axis]) < .011), 'Search substituted an anatomical target or native coordinate.');
    assert((await page.locator('.coordinate-status').textContent()).includes(match.name), 'Search did not select its source structure.');
    assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) === 1 && await page.getByLabel('View layout').inputValue() === 'quad', 'Search did not begin with complete sections and 3D context.');
    const key = 'neuroimage:scene:' + match.atlas_key;
    const saved = await page.evaluate(key => localStorage.getItem(key),key);
    const changed = actual[0] + 1;
    await page.getByLabel('R coordinate in millimeters').fill(String(changed)); await ready();
    await page.getByRole('button',{name:'Data and builds',exact:true}).click();
    assert(await page.getByLabel('Search all local structures',{exact:true}).inputValue() === fixture.query, 'Returning to the library lost the search query.');
    assert(await search.getByRole('listitem',{name:match.name + ' · ' + match.dataset_id + ' · ' + match.package_version,exact:true}).isVisible(), 'Returning to the library lost the exact source results.');
    await page.getByRole('button',{name:'Back to atlas',exact:true}).click(); await ready();
    assert(Math.abs((await position())[0]-changed) < .011, 'Returning to a searched atlas reapplied the old search target.');
    assert(await page.evaluate(key => localStorage.getItem(key),key) === saved, 'Search or workspace return overwrote a saved scene.');
    opened.push({dataset_id:fixture.dataset,package_version:fixture.version,structure_id:match.structure_id,source_position_ras_mm:actual,return_position_ras_mm:await position()});
  }
  assert(!errors.length && !external.length, 'Structure lookup used external services or produced browser errors.');
  return {status:'passed',broad_results:broad.total,pagination:[broad.matches.length,next.matches.length],historical_trigeminal_versions:nerves.map(item=>item.package_version),filtered_structure_matches:filtered.total,opened,page_errors:errors,external_requests:external};
}
