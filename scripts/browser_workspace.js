async page => {
  const errors = [], external = [], operations = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin);
  await page.getByRole('button', {name:'Source recipes', exact:true}).waitFor();
  const sources = await page.evaluate(async () => {
    const data = await (await fetch('/api/workspace')).json();
    return data.sources.map(source => ({id:source.id, title:source.title, peak:source.plan?.peak_additional_bytes,
      present:source.inputs_present, required:source.inputs_required, notices:source.sources.length}));
  });
  assert(sources.length === 6 && sources.every(source => source.notices > 0), 'All six uniform source recipes and notices must be present');
  assert(sources.every(source => source.peak === 0 && source.present === source.required), 'This reuse fixture requires all six existing source inputs');
  await page.evaluate(() => scrollTo(0,0));
  await page.screenshot({path:'output/playwright/workspace-sources.png'});
  const source = page.getByRole('article', {name:sources.find(source => source.id === 'brainstem_navigator_mni').title, exact:true});
  async function operation(button) {
    const response = page.waitForResponse(response => response.url() === origin + '/api/workspace/jobs' && response.request().method() === 'POST');
    await button.click();
    const started = await response, value = await started.json();
    assert(started.status() === 202, 'The selected local operation did not start: ' + JSON.stringify(value));
    await page.waitForFunction(id => {
      const row = document.querySelector('[aria-label="Operation ' + id + '"] .job-status');
      return row && !['running','stopping'].includes(row.textContent);
    }, value.id, {timeout:90000});
    const job = await page.evaluate(async id => (await (await fetch('/api/workspace')).json()).jobs.find(job => job.id === id), value.id);
    assert(job.status === 'complete', 'Operation failed: ' + job.detail);
    operations.push(job);
    return job;
  }
  const acquisition = await operation(source.getByRole('button',{name:'Acquire or verify',exact:true}));
  assert(acquisition.result.downloads === 0 && acquisition.result.extracted === 0 && acquisition.result.reused > 0, 'Existing source files were downloaded or expanded again');
  await page.getByRole('button',{name:'Source recipes',exact:true}).click();
  const construction = await operation(source.getByRole('button',{name:'Build or resume',exact:true}));
  const build = construction.events.find(event => event.event === 'build-complete');
  assert(build && build.reused === 41 && build.built === 0 && build.geometry_recomputed === false, 'The accepted source atlas was rebuilt unnecessarily');
  const row = page.getByRole('article',{name:'Operation ' + construction.id, exact:true});
  await row.getByRole('button',{name:'Browse atlas',exact:true}).click();
  const ready = () => page.waitForFunction(() => /^(Ready|Notebook scene restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:60000});
  await ready();
  const key = construction.result.atlas_key;
  assert(await page.getByLabel('Local atlas',{exact:true}).inputValue() === key, 'Construction opened another source version');
  assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) === 1, 'The atlas did not start with full source sections');
  const position = await Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue()));
  await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();
  assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) > 1, 'Cursor magnification was unavailable');
  await page.getByRole('button',{name:'Full sections',exact:true}).click();
  const returned = await Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue()));
  assert(JSON.stringify(position) === JSON.stringify(returned), 'Full-section navigation moved the anatomical point');
  await page.getByRole('button',{name:'Data and builds',exact:true}).click();
  await page.getByRole('button',{name:'Local atlases',exact:true}).click();
  await page.getByLabel('Workspace dataset filter').selectOption('brainstem_navigator_mni');
  const version = key.slice(-16);
  const local = page.locator('.local-package').filter({has:page.locator('code',{hasText:version})});
  await local.getByRole('button',{name:'Open atlas',exact:true}).click();
  await ready();
  assert(await page.getByLabel('Local atlas',{exact:true}).inputValue() === key, 'The library opened a different package');
  await page.getByRole('button',{name:'Data and builds',exact:true}).click();
  await page.getByRole('button',{name:'Local atlases',exact:true}).click();
  await page.getByLabel('Workspace dataset filter').selectOption('brainstem_navigator_mni');
  const prepared = await operation(local.getByRole('button',{name:'Prepare teaching',exact:true}));
  const content = await page.evaluate(async id => (await (await fetch('/api/workspace/content/' + id)).json()).content, prepared.id);
  assert(content.scenes.length === 6 && content.package_version === version, 'Teaching preparation changed source identity');
  const storageKey = 'neuroimage:notebook:primary:' + key;
  const previous = await page.evaluate(key => localStorage.getItem(key), storageKey);
  assert(previous === null, 'Use an isolated browser profile; existing user notebook retained');
  const sentinel = JSON.stringify({...content,id:'workspace-preserved-notebook',title:'Preserved browser notebook fixture'});
  await page.evaluate(({key,value}) => localStorage.setItem(key,value),{key:storageKey,value:sentinel});
  try {
    await page.getByRole('article',{name:'Operation ' + prepared.id,exact:true}).getByRole('link',{name:'Open prepared notebook',exact:true}).click();
    await ready();
    assert(await page.getByRole('region',{name:'Notebook presentation'}).isVisible(), 'The prepared notebook did not open in presentation mode');
    assert(await page.getByLabel('Local atlas',{exact:true}).inputValue() === key, 'The prepared notebook selected another native space');
    assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) === 1, 'Teaching did not start with full source sections');
    for (let index = 0; index < 6; index++) {
      await page.waitForFunction(number => document.querySelector('.notebook-presentation .lesson-progress')?.textContent?.startsWith('Scene ' + number + ' of'), index + 1);
      await ready();
      const actual = await Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
      assert(actual.every((value, axis) => Math.abs(value - content.scenes[index].scene.state.position[axis]) < .011), 'A teaching scene moved from its source coordinate');
      if (index === 0) await page.screenshot({path:'output/playwright/workspace-teaching.png'});
      if (index < 5) await page.getByRole('button',{name:'Next view',exact:true}).click();
    }
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:'Export teaching image',exact:true}).click();
    const exportPath = 'data/exports/brainstem_navigator_mni/workspace-acceptance/teaching-image-' + prepared.id + '.zip';
    await (await download).saveAs(exportPath);
    assert(await page.evaluate(key => localStorage.getItem(key),storageKey) === sentinel, 'Workspace preparation replaced an existing saved notebook');
    await page.reload(); await ready();
    assert(await page.getByRole('region',{name:'Notebook presentation'}).isVisible(), 'Reload lost the exact prepared notebook');
    await page.getByRole('button',{name:'Data and builds',exact:true}).click();
    await page.getByRole('button',{name:'Operations',exact:true}).click();
    assert(await page.getByRole('article',{name:'Operation ' + prepared.id,exact:true}).isVisible(), 'Completed job history was lost');
    const viewport = page.viewportSize(); await page.setViewportSize({width:720,height:1050});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Workspace controls overflow a narrow viewport');
    await page.setViewportSize(viewport);
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({path:'output/playwright/workspace-operations.png'});
    assert(!errors.length && !external.length, 'The offline workspace had browser errors or external requests');
    return {status:'passed',sources,operations:operations.map(job => ({id:job.id,request:job.request,result:job.result,events:job.events})),
      package_key:key,full_sections_and_magnification:'same physical cursor',teaching_scenes:6,export:exportPath.replace(/^data\//,''),
      prepared_job:prepared.id,existing_browser_notebook:'unchanged',page_errors:errors,external_requests:external};
  } finally { await page.evaluate(key => localStorage.removeItem(key),storageKey); }
}
