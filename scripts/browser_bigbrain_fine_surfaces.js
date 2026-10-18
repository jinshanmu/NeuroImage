async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [], reports = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const ids = ['bigbrain-layers-observation', 'bigbrain-hippocampus-observation'];
  const versions = {'bigbrain-layers-observation': '28962750493fb674', 'bigbrain-hippocampus-observation': '3583b4ba664391c6'};
  const output = 'data/benchmarks/bigbrain_surfaces/fine-anatomy-20261014/browser';
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.setViewportSize({width: 1920, height: 1100});
  const ready = async () => {
    await page.waitForFunction(() => document.querySelector('.model-status')?.textContent?.startsWith('Ready'), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(), 'The source model reported an error.');
  };
  const listing = await (await page.request.get(origin + '/api/workspace/teaching')).json();
  for (const id of ids) {
    const candidates = listing.records.filter(item => item.status === 'ready' && item.binding.package_version === versions[id]
      && item.relative_path.includes('/' + id + '-'));
    assert(candidates.length === 1, 'Select one prepared source-bound notebook: ' + id);
    const record = candidates[0];
    const opened = await (await page.request.get(origin + '/api/workspace/teaching/' + record.key)).json();
    const book = opened.content;
    await page.goto(origin + '/?teaching-content=' + record.key);
    await ready();
    const atlasKey = await page.getByRole('combobox', {name: 'Source', exact: true}).inputValue();
    const storageKey = 'neuroimage:model:primary:' + atlasKey + ':content:' + record.key;
    const canvas = page.getByLabel('Independent native source model', {exact: true});
    const rows = [];
    for (let index = 0; index < book.scenes.length; index++) {
      if (index) { await page.getByRole('button', {name: 'Next view', exact: true}).click(); await ready(); }
      await page.getByRole('button', {name: 'Save scene', exact: true}).click();
      const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      const expected = book.scenes[index].scene;
      for (const field of ['selected', 'position_native_mm', 'visible', 'surfaceOpacity', 'surfaceCutaway', 'highlightSelected', 'note', 'camera', 'focus_native_mm']) {
        assert(JSON.stringify(saved.state[field]) === JSON.stringify(expected.state[field]), id + ': changed ' + field);
      }
      assert(saved.build_signature === book.build_signature && saved.space_id === book.space_id, 'A native source binding changed.');
      let archive = null;
      if ([0, 3, 6, 7, 14, 15].includes(index)) {
        await page.mouse.move(5, 5);
        const download = page.waitForEvent('download');
        await page.getByRole('button', {name: 'Export teaching image', exact: true}).click();
        archive = output + '/' + id + '/view-' + (index + 1) + '.zip';
        await (await download).saveAs(archive);
      }
      if (index === 0) {
        await page.mouse.move(5, 5);
        await canvas.screenshot({path: output + '/' + id + '/saved.png'});
        const download = page.waitForEvent('download');
        await page.getByRole('button', {name: 'Export scene', exact: true}).click();
        const scene = output + '/' + id + '/scene.json';
        await (await download).saveAs(scene);
        await page.getByRole('button', {name: 'Focus selected', exact: true}).click(); await ready();
        await page.getByRole('button', {name: 'Restore saved', exact: true}).click(); await ready();
        await page.mouse.move(5, 5);
        await canvas.screenshot({path: output + '/' + id + '/restored.png'});
        await page.getByLabel('Import model scene file', {exact: true}).setInputFiles(scene); await ready();
        await page.mouse.move(5, 5);
        await canvas.screenshot({path: output + '/' + id + '/imported.png'});
        await page.getByRole('button', {name: 'Return to recorded view', exact: true}).click(); await ready();
      }
      rows.push({title: book.scenes[index].title, selected: saved.state.selected, native_target: saved.state.position_native_mm,
        visible: saved.state.visible, export: archive?.replace(/^data\//, '') ?? null});
    }
    reports.push({curriculum: id, notebook_key: record.key, source_package: book.package_id, package_version: book.package_version, scenes: rows});
  }
  assert(reports.reduce((sum, item) => sum + item.scenes.length, 0) === 30, 'Visit every new source-model view.');
  assert(!errors.length && !external.length, 'Source model browsing produced errors or external requests.');
  return {status: 'passed', reports, page_errors: errors, external_requests: external};
}
