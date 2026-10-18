async page => {
  const errors = [], external = [], reports = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const requested = new URL(page.url()).searchParams.get('acceptance-datasets')?.split(',');
  const runTag = new URL(page.url()).searchParams.get('acceptance-output') ?? '';
  assert(!runTag || /^[a-z0-9-]{1,48}$/.test(runTag), 'Use a short filename-safe acceptance output tag.');
  const versions = Object.fromEntries((new URL(page.url()).searchParams.get('acceptance-versions') ?? '').split(',').filter(Boolean).map(value => value.split(':')));
  const origin = new URL(page.url()).origin;
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  // Observe browser API allocations, without reading application objects.
  await page.addInitScript(() => {
    const sizes = new WeakMap(), bound = new Map();
    const probe = window.__specialistResources = {live_buffer_bytes:0, peak_buffer_bytes:0, deleted_buffers:0};
    const api = WebGL2RenderingContext.prototype;
    const bind = api.bindBuffer, allocate = api.bufferData, remove = api.deleteBuffer;
    api.bindBuffer = function(target, buffer) { bound.set(target, buffer); return bind.call(this, target, buffer); };
    api.bufferData = function(target, data, ...rest) {
      const result = allocate.call(this, target, data, ...rest), buffer = bound.get(target);
      if (buffer) {
        const bytes = typeof data === 'number' ? data : data?.byteLength ?? 0;
        probe.live_buffer_bytes += bytes - (sizes.get(buffer) ?? 0); sizes.set(buffer, bytes);
        probe.peak_buffer_bytes = Math.max(probe.peak_buffer_bytes, probe.live_buffer_bytes);
      }
      return result;
    };
    api.deleteBuffer = function(buffer) {
      if (buffer && sizes.has(buffer)) { probe.live_buffer_bytes -= sizes.get(buffer); sizes.delete(buffer); probe.deleted_buffers++; }
      return remove.call(this, buffer);
    };
  });
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Notebook scene restored|Teaching export prepared|Scene saved|Saved scene restored|Scene file restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(), 'The application reported a visible error.');
  };
  const coordinates = () => Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const recipes = [
    {dataset:'hcp1065_tracts', curriculum:'hcp1065-specialist-pathways', module:'white-matter-pathways', count:87, scenes:10},
    {dataset:'mida', curriculum:'mida-cranial-skull-context', module:'cranial-nerves', count:51, scenes:9},
    {dataset:'spl_nac', curriculum:'spl-cisternal-regions', module:'cisternal-regions', count:105, scenes:6, version:'5540cfe690956d43'},
    {dataset:'mouches_arteries', curriculum:'mouches-arterial-occurrence', module:'vascular-anatomy', count:1, scenes:5},
    {dataset:'brainstem_navigator_mni', curriculum:'brainstem-expanded-regions', module:'general-anatomy', count:86, scenes:18},
    {dataset:'ixi_mra', curriculum:'ixi-native-mra-observation', module:'vascular-anatomy', count:0, scenes:4},
  ];
  await page.setViewportSize({width:1720,height:1120});
  for (const fixture of recipes.filter(item => !requested || requested.includes(item.dataset))) {
    await page.goto(origin);
    await page.getByLabel('Learning module',{exact:true}).waitFor();
    const workspace = await page.evaluate(async () => (await (await fetch('/api/workspace')).json()));
    const version = versions[fixture.dataset] ?? fixture.version;
    const candidates = workspace.packages.filter(record => record.dataset_id === fixture.dataset && record.status === 'available' && record.structures === fixture.count && (!version || record.package_version === version) && record.compatible_curricula.includes(fixture.curriculum));
    assert(candidates.length === 1, 'Select exactly one source package for ' + fixture.dataset);
    const target = candidates[0];
    await page.getByLabel('Learning module',{exact:true}).selectOption(fixture.module);
    const expectedSources = workspace.sources.filter(source => source.coverage.some(entry => entry.id === fixture.module));
    assert(await page.locator('.source-card').count() === expectedSources.length, 'Module source coverage filter is inconsistent.');
    await page.getByRole('button',{name:'Local atlases',exact:true}).click();
    await page.getByLabel('Workspace dataset filter').selectOption(fixture.dataset);
    const row = page.locator('.local-package').filter({has:page.locator('code',{hasText:target.package_version})});
    await row.getByLabel('Teaching recipe for ' + target.key).selectOption(fixture.curriculum);
    const started = page.waitForResponse(response => response.url() === origin + '/api/workspace/jobs' && response.request().method() === 'POST');
    await row.getByRole('button',{name:'Prepare teaching',exact:true}).click();
    const response = await started, job = await response.json();
    assert(response.status() === 202, 'Teaching preparation request was rejected.');
    await page.waitForFunction(id => document.querySelector('[aria-label="Operation ' + id + '"] .job-status')?.textContent === 'complete', job.id, {timeout:90000});
    const content = await page.evaluate(async id => (await (await fetch('/api/workspace/content/' + id)).json()).content, job.id);
    assert(content.scenes.length === fixture.scenes && content.package_version === target.package_version, 'Prepared notebook changed the source version or scene count.');
    await page.getByRole('article',{name:'Operation ' + job.id,exact:true}).getByRole('link',{name:'Open prepared notebook',exact:true}).click();
    await ready();
    assert(await page.getByRole('region',{name:'Notebook presentation'}).isVisible(), 'Prepared teaching did not open.');
    const key = 'neuroimage:notebook:primary:' + target.key;
    const previous = await page.evaluate(key => localStorage.getItem(key), key);
    assert(previous === null, 'Use an isolated profile; existing notebook retained.');
    const output = 'data/exports/' + fixture.dataset + '/specialist-browser-' + content.id + (runTag ? '-' + runTag : '');
    const scenes = [];
    for (let index = 0; index < content.scenes.length; index++) {
      const entry = content.scenes[index];
      await ready();
      const actual = await coordinates();
      assert(actual.every((value, axis) => Math.abs(value - entry.scene.state.position[axis]) < .011), 'Teaching moved from its source coordinate: ' + entry.title);
      assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) === 1, 'Full source sections were lost.');
      const resource = await page.evaluate(() => ({...window.__specialistResources, javascript_heap_bytes:performance.memory?.usedJSHeapSize ?? null}));
      if (index === 0) {
        await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click(); await ready();
        assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) > 1, 'Cursor magnification is unavailable.');
        assert(JSON.stringify(await coordinates()) === JSON.stringify(actual), 'Magnifying moved the physical point.');
        await page.getByRole('button',{name:'Full sections',exact:true}).click(); await ready();
        await page.getByRole('checkbox',{name:'Radiological',exact:true}).uncheck(); await ready();
        assert(JSON.stringify(await coordinates()) === JSON.stringify(actual), 'Display convention changed physical coordinates.');
        await page.getByRole('button',{name:'Return to recorded view',exact:true}).click(); await ready();
      }
      if (index === 0 || fixture.dataset === 'spl_nac') {
        await page.locator('.workspace-heading h1').click(); await ready();
        await page.screenshot({path:'output/playwright/specialist-' + fixture.dataset + '-' + (index + 1) + (runTag ? '-' + runTag : '') + '.png'});
      }
      const download = page.waitForEvent('download');
      await page.getByRole('button',{name:'Export teaching image',exact:true}).click();
      const file = output + '/view-' + (index + 1) + '.zip'; await (await download).saveAs(file);
      if (fixture.dataset === 'spl_nac') {
        await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click(); await ready();
        const enlarged = page.waitForEvent('download'); await page.getByRole('button',{name:'Export teaching image',exact:true}).click();
        await (await enlarged).saveAs(output + '/view-' + (index + 1) + '-magnified.zip');
        await page.getByRole('button',{name:'Return to recorded view',exact:true}).click(); await ready();
      }
      scenes.push({title:entry.title, selected:entry.scene.state.selected, position_ras_mm:actual, visible:entry.scene.state.visible, resources:resource, export:file.replace(/^data\//,'')});
      assert(await page.evaluate(key => localStorage.getItem(key),key) === previous, 'Presentation changed a saved browser notebook.');
      if (index + 1 < content.scenes.length) await page.getByRole('button',{name:'Next view',exact:true}).click();
    }
    const portable = page.waitForEvent('download'); await page.getByRole('button',{name:'Export notebook',exact:true}).click();
    const bookFile = output + '/teaching-notebook.json'; await (await portable).saveAs(bookFile);
    await page.getByLabel('Import teaching notebook file').setInputFiles(bookFile);
    await page.getByRole('button',{name:'Present notebook',exact:true}).click(); await ready();
    assert((await coordinates()).every((value,axis) => Math.abs(value - content.scenes[0].scene.state.position[axis]) < .011), 'Portable notebook did not restore the first recorded point.');
    if (fixture.dataset === 'hcp1065_tracts') {
      assert(scenes.every(scene => scene.visible.length <= 6), 'Teaching groups exceeded the six-bundle display plan.');
      assert(scenes.at(-1).resources.deleted_buffers > 0, 'Switching pathway groups did not release graphics buffers.');
    }
    reports.push({dataset_id:fixture.dataset, package_version:target.package_version, notebook_id:content.id, preparation_job:job.id, scenes, portable_notebook:bookFile.replace(/^data\//,'')});
  }
  assert(!errors.length && !external.length, 'Specialist browsing had page errors or external requests.');
  return {status:'passed', reports, buffer_measurement:'Observed WebGL buffer allocations only; excludes volume textures and driver overhead.', page_errors:errors, external_requests:external};
}
