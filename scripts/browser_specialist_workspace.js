async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [], operations = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  const legacyId = new URL(page.url()).searchParams.get('acceptance-legacy-job');
  await page.goto(origin);
  await page.getByRole('button', {name:'Source recipes', exact:true}).waitFor();
  const initial = await page.evaluate(async () => (await (await fetch('/api/workspace')).json()));
  assert(initial.sources.length === 8 && initial.sources.every(source => source.sources.length > 0), 'Expected eight uniform source recipes with individual notices.');
  const fixtures = [
    {id:'mida', assets:55, version:'3374505761bc6543'},
    {id:'brainstem_navigator_mni', assets:263, version:'f753cbca5de01ac4'},
    {id:'ixi_mra', assets:4, version:'ef40bd2a0f6f885d'},
  ];
  for (const fixture of fixtures) {
    const source = initial.sources.find(source => source.id === fixture.id);
    assert(source.plan.peak_additional_bytes === 0 && source.inputs_present === source.inputs_required, 'The reuse fixture requires complete existing inputs.');
    for (const action of ['acquire','build']) {
      await page.getByRole('button', {name:'Source recipes', exact:true}).click();
      const card = page.getByRole('article', {name:source.title, exact:true});
      const response = page.waitForResponse(response => response.url() === origin + '/api/workspace/jobs' && response.request().method() === 'POST');
      await card.getByRole('button', {name:action === 'acquire' ? 'Acquire or verify' : 'Build or resume', exact:true}).click();
      const started = await response, value = await started.json();
      assert(started.status() === 202, 'The installed operation was rejected.');
      await page.waitForFunction(id => {
        const text = document.querySelector('[aria-label="Operation ' + id + '"] .job-status')?.textContent;
        return text && !['running','stopping'].includes(text);
      }, value.id, {timeout:120000});
      const job = await page.evaluate(async id => (await (await fetch('/api/workspace')).json()).jobs.find(job => job.id === id), value.id);
      assert(job.status === 'complete', 'The installed operation failed: ' + job.detail);
      if (action === 'acquire') assert(job.result.downloads === 0 && job.result.extracted === 0 && job.result.reused > 0, 'The installed workspace repeated acquisition.');
      else {
        const event = job.events.find(event => event.event === 'build-complete');
        assert(event?.built === 0 && event.reused === fixture.assets && event.geometry_recomputed === false, 'The installed builder repeated completed work.');
        assert(job.result.atlas_key.endsWith(fixture.version), 'The installed builder changed a source package version.');
      }
      operations.push({id:job.id, request:job.request, result:job.result, events:job.events});
    }
  }
  // The state fixture retains the prior accepted installation's operation records.
  const legacy = legacyId ? {id:legacyId} : initial.jobs.find(job => job.status === 'complete' && job.request.action === 'prepare' && job.request.curriculum === 'brainstem-source-regions');
  assert(legacy, 'Retain an original 0.8.0 prepared-notebook operation for recovery acceptance.');
  await page.goto(origin + '/?workspace-content=' + legacy.id);
  await page.waitForFunction(() => /^(Ready|Notebook scene restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000});
  const recovered = await page.evaluate(async id => (await (await fetch('/api/workspace/content/' + id)).json()).content, legacy.id);
  assert(await page.getByRole('region', {name:'Notebook presentation'}).isVisible(), 'The original prepared notebook did not open.');
  const actual = await Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  assert(actual.every((value, axis) => Math.abs(value - recovered.scenes[0].scene.state.position[axis]) < .011), 'Legacy recovery changed the source observation point.');
  await page.screenshot({path:'output/playwright/specialist-legacy-notebook-recovery.png'});
  assert(!errors.length && !external.length, 'The installed offline workflow had browser errors or external requests.');
  return {status:'passed', source_recipes:initial.sources.map(source => source.id), operations,
    prior_operation_records:initial.jobs.length, legacy_notebook:{job:legacy.id, package_version:recovered.package_version, scenes:recovered.scenes.length, position_ras_mm:actual},
    page_errors:errors, external_requests:external};
}
