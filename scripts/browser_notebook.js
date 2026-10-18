async page => {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(String(error)));
  const origin = new URL(page.url()).origin;
  await page.unroute('**/*');
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.live-status')?.textContent?.startsWith('Ready'), null, {timeout:60000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const catalog = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases);
  const spl = catalog.find(a => a.dataset_id === 'spl_nac'), cerebra = catalog.find(a => a.dataset_id === 'cerebra');
  assert(spl && cerebra, 'Serve SPL/NAC and CerebrA before this check.');
  const storageKey = 'neuroimage:notebook:primary:' + spl.key;
  await page.evaluate(key => {
    const previous = localStorage.getItem(key);
    if (previous && JSON.parse(previous).title !== 'Engineering notebook fixture') throw new Error('Use an isolated browser profile; an existing user notebook is present.');
    localStorage.removeItem(key);
  }, storageKey);
  await page.reload(); await ready();
  await page.getByLabel('Local atlas', {exact:true}).selectOption(spl.key); await ready();
  const manifest = await page.evaluate(async url => (await fetch(url)).json(), spl.manifest_url);
  const putamen = manifest.structures.find(s => s.name === 'Left putamen');
  const caudate = manifest.structures.find(s => s.name === 'Left caudate nucleus');
  assert(putamen && caudate, 'The real-data fixture needs both source labels.');
  const book = page.getByLabel('Teaching notebook editor', {exact:true});
  async function openBook() {
    await page.getByRole('button', {name:'Learn',exact:true}).click();
    if ((await book.getAttribute('open')) === null) await book.locator('summary').click();
  }
  async function choose(structure) { await page.locator('button[title="'+structure.id+'"]').click(); await ready(); }
  async function positions() { return Promise.all(['R','A','S'].map(axis => page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number))); }
  async function capture(title, count) {
    await page.getByLabel('New notebook scene title').fill(title);
    await page.getByRole('button', {name:'Add current view to notebook',exact:true}).click();
    await page.waitForFunction(n => document.querySelectorAll('.notebook-scenes li').length === n, count);
    await page.getByRole('button', {name:'Add current view to notebook',exact:true}).waitFor({state:'visible'});
  }
  await choose(putamen);
  await page.getByLabel('MRI contrast', {exact:true}).selectOption('t2'); await ready();
  await page.getByLabel('Scene teaching notes').fill('First view: inspect the actual source section.');
  await page.getByLabel('New location annotation').fill('Notebook fixture target coordinate.');
  await page.getByRole('button', {name:'Add marker at cursor',exact:true}).click(); await ready();
  await openBook();
  await page.getByLabel('Notebook title', {exact:true}).fill('Engineering notebook fixture');
  await page.getByLabel('Notebook author', {exact:true}).fill('Engineering validation; no anatomical reviewer');
  await page.getByLabel('Notebook learning objective').fill('Verify independent views, explicit sources and recovery.');
  await capture('Putamen on T2',1);
  await page.getByRole('button', {name:'Inspect',exact:true}).click();
  await choose(caudate);
  await page.getByLabel('MRI contrast', {exact:true}).selectOption('t1'); await ready();
  await page.getByLabel('Scene teaching notes').fill('Second view: independently selected source region.');
  await openBook(); await capture('Caudate on T1',2);
  await page.getByRole('button', {name:'Move earlier',exact:true}).click();
  assert((await book.locator('.notebook-scenes button').allTextContents())[0] === '1. Caudate on T1','Scene order was not updated.');
  await page.getByLabel('Notebook discussion prompt').fill('Describe the region visible at the recorded crosshair.');
  await page.getByRole('button', {name:'Remove scene',exact:true}).click();
  assert(await book.locator('.notebook-scenes li').count() === 1,'Scene removal did not take effect.');
  await page.getByRole('button', {name:'Undo scene removal',exact:true}).click();
  assert(await book.locator('.notebook-scenes li').count() === 2,'Scene removal could not be undone.');
  await page.getByLabel('Surface opacity', {exact:true}).press('Home'); await ready();
  await page.getByRole('button', {name:'Update scene from current view',exact:true}).click();
  await book.getByRole('status').filter({hasText:'now contains'}).waitFor();
  await page.getByRole('button', {name:'Open notebook scene 2: Putamen on T2',exact:true}).click(); await ready();
  assert(await page.getByLabel('MRI contrast', {exact:true}).inputValue() === 't2','First scene lost its contrast.');
  assert((await positions()).every((v,i)=>Math.abs(v-putamen.target_ras_mm[i])<.011),'First scene lost its source coordinates.');
  await page.getByRole('button', {name:'Previous scene',exact:true}).click(); await ready();
  assert(await page.getByLabel('MRI contrast', {exact:true}).inputValue() === 't1','Second scene lost its contrast.');
  assert(Number(await page.getByLabel('Surface opacity', {exact:true}).inputValue()) === 0,'Updating a scene did not preserve its new display state.');
  await page.getByLabel('Local atlas', {exact:true}).selectOption(cerebra.key); await ready();
  await page.getByLabel('Local atlas', {exact:true}).selectOption(spl.key); await ready(); await openBook();
  assert(await book.locator('.notebook-scenes li').count() === 2,'Unsaved notebook was lost during source switching.');
  await page.getByRole('button', {name:'Save notebook',exact:true}).click();
  await book.getByRole('status').filter({hasText:'saved in this browser'}).waitFor();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
  assert(saved.scenes.length===2 && saved.scenes[0].scene.state.selected===caudate.id && saved.scenes[1].scene.state.selected===putamen.id,'Saved scenes changed order or structure identity.');
  assert(saved.scenes[1].scene.state.annotations[0].text==='Notebook fixture target coordinate.','Capture lost the coordinate annotation.');
  assert(saved.review_status==='user-authored-unreviewed','Notebook claims an independent review.');
  const exportPath='data/exports/spl_nac/browser-validation/teaching-notebook.json';
  const file=page.waitForEvent('download');
  await page.getByRole('button', {name:'Export notebook',exact:true}).click();
  await (await file).saveAs(exportPath);
  await page.reload(); await ready(); await openBook();
  assert(await book.locator('.notebook-scenes li').count()===2,'Browser restart lost the saved notebook.');
  await page.getByRole('button', {name:'Open notebook scene 2: Putamen on T2',exact:true}).click(); await ready();
  const wrong={...saved,space_id:'incompatible-native-space'};
  await page.getByLabel('Import teaching notebook file', {exact:true}).setInputFiles({name:'wrong-notebook.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(wrong))});
  await book.getByRole('alert').filter({hasText:'different atlas version or native space'}).waitFor();
  assert(await book.locator('.notebook-scenes li').count()===2,'Invalid import replaced the current notebook.');
  await page.getByLabel('Import teaching notebook file', {exact:true}).setInputFiles(exportPath);
  await book.getByRole('status').filter({hasText:'Notebook imported'}).waitFor();
  await page.getByLabel('Local atlas', {exact:true}).selectOption(cerebra.key); await ready(); await openBook();
  await page.getByLabel('Import teaching notebook file', {exact:true}).setInputFiles(exportPath);
  await book.getByRole('alert').filter({hasText:'different atlas version or native space'}).waitFor();
  assert(await book.locator('.notebook-scenes li').count()===0,'Cross-source notebook was accepted.');
  await page.getByLabel('Local atlas', {exact:true}).selectOption(spl.key); await ready(); await openBook();
  await page.getByRole('button', {name:'Open notebook scene 2: Putamen on T2',exact:true}).click(); await ready();
  await page.getByRole('button', {name:'Present notebook',exact:true}).click(); await ready();
  assert(await page.getByLabel('Notebook presentation', {exact:true}).isVisible(),'Notebook presenter view did not open.');
  assert(!(await page.getByLabel('Notebook title', {exact:true}).isVisible()),'Presenter view still shows the editing form.');
  await page.getByRole('button', {name:'Previous view',exact:true}).click(); await ready();
  assert((await page.getByLabel('Notebook presentation', {exact:true}).textContent()).includes('Describe the region visible at the recorded crosshair.'),'Presenter view lost the discussion prompt.');
  assert((await positions()).every((v,i)=>Math.abs(v-caudate.target_ras_mm[i])<.011),'Presenter navigation did not restore the recorded source position.');
  await page.getByRole('button', {name:'Next view',exact:true}).click(); await ready();
  await page.screenshot({path:'output/playwright/notebook-validated.png'});
  assert(!errors.length&&!external.length,'Notebook workflow encountered a page error or external request.');
  return {status:'passed',package_version:manifest.package_version,scenes:saved.scenes.length,
    checks:['independent source coordinates and contrasts','full notes and markers','reorder and undo removal','explicit scene update','unsaved source-switch recovery','browser restart','portable export/import','invalid import preserves current notebook','cross-source rejection','presenter prompts and navigation'],
    page_errors:errors,external_requests:external,anatomical_review:'not_performed'};
}
