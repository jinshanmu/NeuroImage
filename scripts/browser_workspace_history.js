async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.unroute('**/*');
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const ready = async () => { await page.waitForFunction(() => /^(Ready|Notebook scene restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000}); };
  const openOperations = async () => {
    await page.goto(origin);
    await page.getByRole('button',{name:'SUIT · cerebellar lobules and deep nuclei Atlas ready',exact:true}).click();
    await page.getByRole('button',{name:'Download, install and build',exact:true}).click();
    await page.getByRole('button',{name:'Operations',exact:true}).click();
  };
  const findOperation = async id => {
    await openOperations();
    const article=page.getByRole('article',{name:'Operation '+id,exact:true});
    while (!await article.count()) {
      assert(await page.getByRole('button',{name:'Older operations',exact:true}).isEnabled(),'The retained operation is absent from its history pages.');
      const response=page.waitForResponse(value=>new URL(value.url()).pathname==='/api/workspace'&&Number(new URL(value.url()).searchParams.get('jobs_offset'))>0);
      await page.getByRole('button',{name:'Older operations',exact:true}).click();
      const value=await(await response).json();
      await page.locator('.workspace-jobs').getByRole('status').filter({hasText:`Operations ${value.jobs_offset+1}–${value.jobs_offset+value.jobs.length} of ${value.jobs_total}`}).waitFor();
    }
    return article;
  };
  await openOperations();
  const initial = await page.evaluate(async () => (await (await fetch('/api/workspace')).json()));
  assert(initial.jobs_total > 30 && initial.jobs.length === 30, 'Use a retained workspace with more than thirty completed operations.');
  const earlier = [];
  while (await page.getByRole('button',{name:'Older operations',exact:true}).isEnabled()) {
    const response = page.waitForResponse(response => {
      const url = new URL(response.url()); return url.pathname === '/api/workspace' && Number(url.searchParams.get('jobs_offset')) > 0;
    });
    await page.getByRole('button',{name:'Older operations',exact:true}).click();
    const value = await (await response).json(); earlier.push(...value.jobs);
    await page.locator('.workspace-jobs').getByRole('status').filter({hasText:`Operations ${value.jobs_offset + 1}–${value.jobs_offset + value.jobs.length} of ${value.jobs_total}`}).waitFor();
  }
  const ids = [...initial.jobs,...earlier].map(job => job.id);
  assert(ids.length === initial.jobs_total && new Set(ids).size === ids.length, 'History pages omitted or repeated a saved operation.');
  const legacy = earlier.find(job => job.id === 'a789304abbce4f33b81ec9a65d9f0417');
  assert(legacy, 'Retain the original 0.8.0 prepared notebook operation for this fixture.');
  await(await findOperation(legacy.id)).getByRole('link',{name:'Open prepared notebook',exact:true}).click(); await ready();
  const original = await page.evaluate(async id => (await (await fetch('/api/workspace/content/'+id)).json()).content, legacy.id);
  const point = await Promise.all(['R','A','S'].map(axis => page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  assert(point.every((value,axis) => Math.abs(value-original.scenes[0].scene.state.position[axis])<.011), 'Older notebook navigation moved the source point.');
  const job = [...initial.jobs,...earlier].find(job => job.status==='complete' && job.request.action==='build' && job.result?.atlas_key?.startsWith('ixi_mra-'));
  assert(job, 'Retain an image-only build operation that has not been activated since restart.');
  const article=await findOperation(job.id);
  const before = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()));
  assert(!before.atlases.some(item=>item.key===job.result.atlas_key), 'The fixture target is already registered; restart the workspace before this check.');
  const activated = page.waitForResponse(response => response.url()===origin+'/api/workspace/jobs' && response.request().method()==='POST');
  await article.getByRole('button',{name:'Browse atlas',exact:true}).click();
  const response = await activated, operation = await response.json();
  assert(response.status()===202 && response.request().postDataJSON().action==='activate', 'History browsing skipped exact-package verification.');
  await ready();
  assert(await page.getByLabel('Source',{exact:true}).inputValue()===job.result.atlas_key, 'History opened another package.');
  const final = await page.evaluate(async () => (await (await fetch('/api/workspace')).json()));
  assert(final.jobs_total===initial.jobs_total+1 && final.jobs_offset===0 && !final.active_job, 'History did not return to the completed newest operation.');
  const completed=final.jobs.find(item=>item.id===operation.id);
  assert(completed?.status==='complete', 'The recovered atlas was not verified successfully.');
  assert(!errors.length && !external.length, 'History recovery had browser errors or external requests.');
  return {status:'passed',history_records_before:initial.jobs_total,history_records_after:final.jobs_total,history_pages:Math.ceil(ids.length/30),all_history_ids_preserved:true,
    legacy_notebook:{job:legacy.id,package_version:original.package_version,scenes:original.scenes.length,position_ras_mm:point},
    verified_activation:{job:operation.id,atlas_key:job.result.atlas_key,status:completed.status},page_errors:errors,external_requests:external};
}
