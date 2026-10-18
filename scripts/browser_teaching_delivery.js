async page => {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(String(error)));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Notebook scene restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:60000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const startup = await page.evaluate(async () => {
    const api = await (await fetch('/api/atlases')).json();
    if (!api.startup) throw new Error('Start this fixture with neuroimage open <prepared-notebook.json>.');
    return {api, book:await (await fetch(api.startup.content_url)).json()};
  });
  const {api, book} = startup;
  assert(book.kind === 'neuroimage-teaching-notebook' && book.scenes.length === 6, 'This fixture requires a six-view source-bound notebook.');
  const key = 'neuroimage:notebook:primary:' + api.startup.atlas_key;
  const stored = await page.evaluate(key => localStorage.getItem(key), key);
  assert(stored === null, 'Use an isolated browser profile. Existing user notebook retained.');
  const preserved = {...book, id:'prior-notebook-fixture', title:'Preserved prior browser notebook fixture'};
  const storedText = JSON.stringify(preserved);
  await page.evaluate(({key,text}) => localStorage.setItem(key,text), {key,text:storedText});
  const output = 'data/exports/' + book.package_id + '/notebooks/presentation-' + book.id;
  const checks = [];
  try {
    await page.reload(); await ready();
    assert(await page.getByLabel('Local atlas',{exact:true}).inputValue() === api.startup.atlas_key, 'Startup chose a different atlas');
    assert(await page.getByRole('region',{name:'Notebook presentation'}).isVisible(), 'Startup did not present the notebook');
    assert((await page.getByRole('region',{name:'Notebook presentation'}).textContent()).includes(book.title), 'A prior saved notebook replaced the requested file');
    const canvas = page.locator('canvas');
    for (let i = 0; i < book.scenes.length; i++) {
      const entry = book.scenes[i];
      await page.waitForFunction(number => document.querySelector('.notebook-presentation .lesson-progress')?.textContent?.startsWith('Scene ' + number + ' of'), i + 1);
      await ready();
      const shown = await Promise.all(['R','A','S'].map(axis => page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
      assert(shown.every((value, axis) => Math.abs(value - entry.scene.state.position[axis]) < .011), 'Presentation moved a source target');
      await page.locator('.workspace-heading h1').click(); await ready();
      await canvas.screenshot({path:'output/playwright/teaching-delivery-' + (i+1) + '.png'});
      if (i === 0) {
        const box = await canvas.boundingBox();
        const x = box.x + box.width * .75, y = box.y + box.height * .76;
        await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+51,y-25,{steps:8}); await page.mouse.up();
        await page.getByRole('button',{name:'Return to recorded view',exact:true}).click(); await ready();
        await page.locator('.workspace-heading h1').click();
        await canvas.screenshot({path:'output/playwright/teaching-delivery-returned.png'});
      }
      const image = page.waitForEvent('download'); await page.getByRole('button',{name:'Export teaching image',exact:true}).click();
      await (await image).saveAs(output + '/view-' + (i+1) + '.zip');
      assert(await page.evaluate(key => localStorage.getItem(key),key) === storedText, 'Opening or presenting replaced an existing saved notebook');
      checks.push({index:i+1,title:entry.title,selected:entry.scene.state.selected,position_ras_mm:entry.scene.state.position});
      if (i + 1 < book.scenes.length) await page.getByRole('button',{name:'Next view',exact:true}).click();
    }
    const notebookDownload = page.waitForEvent('download'); await page.getByRole('button',{name:'Export notebook',exact:true}).click();
    const exported = output + '/teaching-notebook.json'; await (await notebookDownload).saveAs(exported);
    await page.getByLabel('Import teaching notebook file').setInputFiles(exported);
    await page.getByRole('button',{name:'Present notebook',exact:true}).click(); await ready();
    await page.locator('.workspace-heading h1').click();
    await canvas.screenshot({path:'output/playwright/teaching-delivery-reimported.png'});
    assert(await page.evaluate(key => localStorage.getItem(key),key) === storedText, 'Portable import overwrote the preserved browser notebook');
    const viewport = page.viewportSize();
    const next = await page.getByRole('button',{name:'Next view',exact:true}).boundingBox();
    assert(next && next.y + next.height <= viewport.height, 'Classroom navigation is below the visible viewport');
    assert(!errors.length && !external.length, 'Teaching delivery had page errors or external requests');
    return {status:'passed',package_id:book.package_id,package_version:book.package_version,build_signature:book.build_signature,
      notebook_id:book.id,scenes:checks,artifact_directory:output.replace(/^data\//,''),existing_browser_notebook:'unchanged',
      automatic_startup:'exact atlas and first scene in presentation mode',page_errors:errors,external_requests:external};
  } finally { await page.evaluate(key => localStorage.removeItem(key),key); }
}
