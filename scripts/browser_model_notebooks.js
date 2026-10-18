async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [], cases = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  await page.unroute('**/*');
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : (external.push(route.request().url()), route.abort()));
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.model-status')?.textContent?.startsWith('Ready'), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(), 'The source model reported an error.');
  };
  const library = await (await page.request.get(origin + '/api/workspace/teaching')).json();
  const ids = ['mug500-source-skull-context', 'z-anatomy-arterial-context', 'z-anatomy-venous-context', 'z-anatomy-nerve-roots', 'z-anatomy-skull-dura'];
  for (const id of ids) {
    const record = library.records.find(item => item.relative_path.includes('/' + id + '-'));
    assert(record, 'Prepared source curriculum is missing: ' + id);
    const opened = await (await page.request.get(origin + '/api/workspace/teaching/' + record.key)).json();
    const book = opened.content, output = 'data/benchmarks/' + record.dataset_id + '/integration-browser';
    await page.goto(origin + '/?teaching-content=' + record.key);
    await ready();
    assert(await page.getByRole('region', {name: 'Model notebook presentation', exact: true}).count() === 1, 'Prepared model notebook did not enter presentation.');
    const key = await page.getByRole('combobox', {name: 'Source', exact: true}).inputValue();
    const viewKey = 'primary:' + key + ':content:' + record.key;
    for (let index = 0; index < book.scenes.length; index++) {
      if (index) { await page.getByRole('button', {name: 'Next view', exact: true}).click(); await ready(); }
      await page.getByRole('button', {name: 'Save scene', exact: true}).click();
      const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), 'neuroimage:model:' + viewKey);
      const actual = saved.state, expected = book.scenes[index].scene.state;
      for (const field of ['selected', 'position_native_mm', 'visible', 'surfaceOpacity', 'surfaceCutaway', 'highlightSelected', 'note']) {
        assert(JSON.stringify(actual[field]) === JSON.stringify(expected[field]), id + ' view ' + (index + 1) + ': changed ' + field);
      }
      assert(saved.build_signature === book.build_signature && saved.space_id === book.space_id, 'Source binding changed.');
      cases.push({curriculum:id, view:index + 1, selected:actual.selected, native_target:actual.position_native_mm});
      if (index === 0 || id === ids[0]) await page.getByLabel('Independent native source model', {exact:true}).screenshot({path:output + '/' + id + '-' + (index + 1) + '.png'});
    }
    if (id === ids[0]) {
      const canvas = page.getByLabel('Independent native source model', {exact:true});
      const baseline = await canvas.screenshot();
      await page.getByRole('button', {name: 'Full model view', exact:true}).click();
      await page.getByRole('button', {name: 'Return to recorded view', exact:true}).click();
      await ready();
      assert(baseline.equals(await canvas.screenshot()), 'Recorded model view did not restore identical canvas pixels.');
      await page.getByRole('button', {name:'Edit notebook',exact:true}).click();
      await page.getByRole('textbox', {name:'Model notebook title',exact:true}).fill('Source skull classroom sequence');
      await page.getByRole('textbox', {name:'Model notebook author',exact:true}).fill('Engineering acceptance');
      await page.getByRole('textbox', {name:'Selected model view title',exact:true}).fill('Inner source surface');
      await page.getByRole('button', {name:'Move earlier',exact:true}).click();
      await page.getByRole('button', {name:'Remove view',exact:true}).click();
      await page.getByRole('button', {name:'Undo view removal',exact:true}).click();
      await page.getByRole('button', {name:'Save notebook',exact:true}).click();
      const bookKey = 'neuroimage:model-notebook:' + viewKey;
      const saved = await page.evaluate(k => JSON.parse(localStorage.getItem(k)), bookKey);
      assert(saved.title === 'Source skull classroom sequence' && saved.scenes.length === 2 && saved.scenes[0].title === 'Inner source surface', 'Notebook edit, ordering or undo changed.');
      const download = page.waitForEvent('download');
      await page.getByRole('button', {name:'Export notebook',exact:true}).click();
      await (await download).saveAs(output + '/edited-model-notebook.json');
      await page.getByRole('textbox', {name:'Model notebook title',exact:true}).fill('Working draft across the library');
      await page.getByRole('button', {name:'Teaching library',exact:true}).click();
      assert(await page.getByRole('region',{name:'Independent source model viewer',exact:true}).count() === 0, 'Library retained an unnecessary viewer.');
      await page.getByRole('searchbox',{name:'Search teaching library',exact:true}).fill(record.title);
      await page.getByRole('article',{name:record.title,exact:true}).getByRole('button',{name:'Open notebook',exact:true}).click();
      await ready();
      await page.getByRole('button', {name:'Edit notebook',exact:true}).click();
      assert(await page.getByRole('textbox', {name:'Model notebook title',exact:true}).inputValue() === 'Working draft across the library', 'Switching away lost the unsaved working draft.');
      await page.getByLabel('Import model notebook file', {exact:true}).setInputFiles(output + '/edited-model-notebook.json');
      assert(await page.getByRole('textbox', {name:'Model notebook title',exact:true}).inputValue() === saved.title, 'Exported notebook did not import.');
      await page.getByRole('button', {name:'Save notebook',exact:true}).click();
      await page.screenshot({path:output + '/notebook-editor.png'});
      await page.getByRole('button', {name:'Teaching library',exact:true}).click();
      await page.getByLabel('Import teaching file', {exact:true}).setInputFiles(output + '/edited-model-notebook.json');
      await page.getByRole('article',{name:saved.title,exact:true}).getByRole('button',{name:'Open notebook',exact:true}).click();
      await ready();
      assert((await page.getByRole('region',{name:'Model notebook presentation',exact:true}).innerText()).includes(saved.title), 'Imported library model notebook did not open.');
    }
  }
  page.off('pageerror', onError); await page.unroute('**/*');
  assert(!errors.length && !external.length, errors.concat(external).join('\n'));
  return {status:'passed', curricula:ids.length, verified_views:cases.length, cases,
    checks:['Exact native XYZ and source binding', 'Prepared presentation navigation', 'Pixel-identical return to recorded cutaway', 'Editing and reordering', 'Removal undo', 'Explicit save and portable import/export', 'Draft survives library navigation', 'Imported library presentation', 'Offline requests only'], page_errors:errors, external_requests:external};
}
