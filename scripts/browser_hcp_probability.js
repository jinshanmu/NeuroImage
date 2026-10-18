async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [], reports = [];
  const caseNumber = 'HCP1065-PROB';
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin
    ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.setViewportSize({width: 1920, height: 1100});
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const coordinates = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const output = 'data/benchmarks/hcp1065_prob/fine-anatomy-20261014/browser';
  const datasets = /^hcp1065_prob$/;
  const listing = await page.evaluate(async () => (await (await fetch('/api/workspace/teaching?q=HCP1065')).json()).records);
  const targets = listing.filter(item => item.status === 'ready' && item.kind === 'neuroimage-teaching-notebook'
    && datasets.test(item.dataset_id)).sort((a, b) => a.dataset_id.localeCompare(b.dataset_id));
  assert(targets.length === 4, 'The selected native probability notebooks must be unique and available.');
  for (const target of targets) {
    const opened = await page.evaluate(async key => (await (await fetch('/api/workspace/teaching/' + key)).json()), target.key);
    const notebook = opened.content;
    const capture = "hcp1065-probability-" + notebook.title.split(" · ")[1].split(" ")[0];
    await page.goto(origin + '/?teaching-content=' + target.key);
    await ready();
    const canvas = page.locator('.canvas-shell canvas');
    const rows = [];
    for (let index = 0; index < notebook.scenes.length; index++) {
      await ready();
      const entry = notebook.scenes[index], expected = entry.scene.state;
      const position = await coordinates();
      assert(position.every((v, axis) => Math.abs(v - expected.position[axis]) < .011), 'A source teaching target changed: ' + entry.title);
      assert(await page.getByLabel('View layout', {exact: true}).inputValue() === 'anatomy', 'The accepted equal-panel layout was lost.');
      assert(await page.getByLabel('Fit visible 3D', {exact: true}).isChecked(), 'The complete visible source geometry must fit its frame.');
      assert(Number(await page.getByLabel('2D zoom', {exact: true}).inputValue()) === expected.pan[3], 'The recorded MRI field of view changed.');
      const bounds = await canvas.boundingBox();
      assert(bounds.width > 1200 && bounds.x + bounds.width <= 1921, 'The complete four-panel canvas must fit the browser.');
      assert(await page.getByLabel('Evidence overlay', {exact: true}).inputValue() === expected.overlay, 'The recorded evidence field changed.');
      const probability = expected.overlay === 'probability' ? Number(await page.getByLabel('Source probability at cursor', {exact:true}).textContent()) : null;
      assert(probability === null || Number.isFinite(probability) && probability >= 0 && probability <= 1, 'The native probability sample must be available.');
      let archive = null;
      if (index < 2 || capture.endsWith('-commissural')) {
        await page.mouse.move(5, 5);
        const download = page.waitForEvent('download');
        await page.getByRole('button', {name: 'Export teaching image', exact: true}).click();
        archive = output + '/' + capture + '/view-' + (index + 1) + '.zip';
        await (await download).saveAs(archive);
      }
      if (index === 0) {
        await page.getByRole('button', {name: 'Save scene', exact: true}).click();
        await ready();
        await page.mouse.move(5, 5);
        await canvas.screenshot({path: output + '/' + capture + '/saved.png'});
        const download = page.waitForEvent('download');
        await page.getByRole('button', {name: 'Export scene', exact: true}).click();
        const file = output + '/' + capture + '/scene.json';
        await (await download).saveAs(file);
        await page.getByLabel('R coordinate in millimeters').fill(String(position[0] + 1));
        await page.getByLabel('R coordinate in millimeters').press('Tab');
        await ready();
        await page.getByRole('button', {name: 'Restore saved', exact: true}).click();
        await ready();
        assert(JSON.stringify(await coordinates()) === JSON.stringify(position), 'Scene restoration changed the source point.');
        await page.mouse.move(5, 5);
        await canvas.screenshot({path: output + '/' + capture + '/restored.png'});
        await page.getByLabel('Import scene file').setInputFiles(file);
        await ready();
        assert(JSON.stringify(await coordinates()) === JSON.stringify(position), 'Portable scene import changed the source point.');
        await page.mouse.move(5, 5);
        await canvas.screenshot({path: output + '/' + capture + '/imported.png'});
        await page.getByRole('button', {name: 'Return to recorded view', exact: true}).click();
        await ready();
      }
      rows.push({title: entry.title, selected: expected.selected, position_ras_mm: position, slice_zoom: expected.pan[3],
        visible: expected.visible, overlay: expected.overlay, source_probability_at_cursor: probability, export: archive?.replace(/^data\//, '') ?? null});
      if (index + 1 < notebook.scenes.length) await page.getByRole('button', {name: 'Next view', exact: true}).click();
    }
    reports.push({dataset_id: target.dataset_id, capture_id: capture, package_version: target.binding.package_version,
      notebook_key: target.key, notebook_id: notebook.id, scenes: rows});
  }
  assert(reports.reduce((total, r) => total + r.scenes.length, 0) === 68, 'Every new teaching view must be visited.');
  assert(errors.length === 0 && external.length === 0, 'Browser acceptance found page errors or external requests.');
  return {status: 'passed', source: caseNumber, reports, page_errors: errors, external_requests: external,
    layout: 'Four equal panels in one row; complete visible 3D at the right; exact reference MRI subarray and original probability grids retained.'};
}
