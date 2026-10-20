async page => {
  // Playwright CLI regression check: use an isolated profile and the local workspace.
  // Acquisition/build responses are mocked below; no source files are changed.
  const origin = new URL(page.url()).origin, checks = [], errors = [], discovery = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const onError = error => errors.push(String(error));
  const onRequest = request => {
    if (new URL(request.url()).pathname === '/api/workspace/browse') discovery.push(request.url());
  };
  page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', onError); page.on('request', onRequest);
  const homeReady = async (target = page) => {
    await target.locator('.anatomy-home').waitFor();
    await target.waitForFunction(() => {
      const refresh = document.querySelector('.dataset-sidebar .manager-heading button');
      return refresh && !refresh.disabled;
    });
    await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const ready = async () => {
    await page.locator('.live-status').filter({hasText:/^Ready/}).waitFor();
    assert(!await page.getByRole('alert').count(), 'The atlas reported a viewer error.');
  };
  const home = async () => {
    await page.getByRole('link', {name:'NeuroImage home', exact:true}).click();
    await homeReady();
  };
  const dataset = async () => {
    await page.locator('.dataset-sidebar').getByRole('button', {name:/^CerebrA /}).click();
    await page.locator('.dataset-configurations button').first().click();
  };
  let extraPage;
  try {
    const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace/browse');
    await page.goto(origin + '/?view=anatomy');
    const library = await (await initialResponse).json();
    await homeReady();
    const families = await page.locator('.dataset-row').count();
    assert(discovery.length === 1, 'Opening a page must check the library once.');
    assert(!await page.getByRole('banner').getByRole('button', {name:'Browse anatomy', exact:true}).count(), 'The redundant header button remains.');
    await page.getByRole('button', {name:'Explore details for Cerebral cortex', exact:true}).click();
    await home();
    await dataset();
    const workspaceResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace');
    await page.getByRole('button', {name:'Download and build', exact:true}).click();
    const workspace = await (await workspaceResponse).json();
    await page.getByRole('button', {name:'Refresh workspace', exact:true}).waitFor();
    await page.getByRole('button', {name:'Back to dataset', exact:true}).click();
    await home();
    assert(discovery.length === 1, 'Group, dataset or management navigation repeated discovery.');
    assert(await page.locator('.dataset-row').count() === families, 'Dataset navigation lost a source family.');
    checks.push('Group, dataset and management navigation reuse the initial discovery');

    await page.getByRole('combobox', {name:'Source for Cerebral cortex', exact:true}).selectOption('cerebra');
    await page.getByRole('button', {name:'Browse Cerebral cortex', exact:true}).click();
    await ready();
    for (const layout of ['3d', 'quad']) {
      await page.getByRole('combobox', {name:'View layout', exact:true}).selectOption(layout);
      await ready();
    }
    await home();
    await page.goBack(); await ready();
    await page.goForward(); await homeReady();
    assert(discovery.length === 1, 'Atlas return or browser history repeated discovery.');
    assert(!await page.getByText('Checking your local source library…', {exact:true}).count(), 'Returning home still shows resource detection.');
    checks.push('2D/3D atlas navigation and browser history reuse the library');

    await page.getByRole('button', {name:'Refresh', exact:true}).click(); await homeReady();
    assert(discovery.length === 2 && discovery[1].endsWith('?refresh=1'), 'Manual refresh must perform exactly one new discovery.');
    await page.reload(); await homeReady();
    assert(discovery.length === 3, 'Reloading the page must check once again.');
    extraPage = await page.context().newPage();
    let newPageChecks = 0;
    extraPage.on('request', request => { if (new URL(request.url()).pathname === '/api/workspace/browse') newPageChecks++; });
    await extraPage.goto(origin + '/?view=anatomy'); await homeReady(extraPage);
    assert(newPageChecks === 1, 'A new tab must have its own initial discovery.');
    await extraPage.close(); extraPage = undefined;
    await page.screenshot({path:'output/playwright/home-navigation.png', fullPage:true});
    checks.push('Manual refresh, page reload and a new tab each check once');

    let fail = true, before = discovery.length;
    await page.route(url => url.pathname === '/api/workspace/browse', async route => {
      await route.fulfill({status:fail ? 503 : 200, json:fail ? {error:'Simulated library failure'} : library});
    });
    await page.reload();
    await page.getByRole('alert').filter({hasText:'Simulated library failure'}).waitFor();
    await page.getByRole('button', {name:'Dismiss', exact:true}).click();
    assert(await page.getByRole('button', {name:'Refresh', exact:true}).isEnabled(), 'Dismissing an error must not leave a permanent loading state.');
    fail = false;
    await page.getByRole('button', {name:'Refresh', exact:true}).click(); await homeReady();
    assert(discovery.length === before + 2, 'A failed check must remain retryable.');
    await home();
    assert(discovery.length === before + 2, 'Successful recovery was not retained.');
    checks.push('Failed discovery can be dismissed, retried and reused');
    await page.unrouteAll({behavior:'wait'});

    // Simulate starting a build, leaving its management page, then finishing it.
    // Every operation endpoint in this phase is intercepted before reaching the service.
    const fixture = {id:'navigation-fixture',title:'Navigation fixture',sources:[],inputs_present:0,inputs_required:1};
    let started = false, completed = false;
    const job = () => ({id:'navigation-test-job',status:completed ? 'complete' : 'running',
      started_utc:'2026-10-20T00:00:00Z',detail:'Navigation regression fixture',request:{action:'build',recipe:'cerebra'},events:[]});
    await page.route(url => url.pathname === '/api/workspace', route => route.fulfill({json:{
      ...workspace, active_job:started && !completed ? job().id : null, jobs:started ? [job()] : [], jobs_total:started ? 1 : 0
    }}));
    await page.route(url => url.pathname === '/api/workspace/jobs', route => {
      assert(route.request().method() === 'POST', 'Unexpected operation request.');
      started = true; return route.fulfill({status:202,json:job()});
    });
    await page.route(url => url.pathname.startsWith('/api/workspace/jobs/'), route => route.fulfill({json:job()}));
    await page.route(url => url.pathname === '/api/workspace/browse', route => route.fulfill({json:{
      ...library, active_job:started && !completed ? job().id : null, sources:completed ? [...library.sources,fixture] : library.sources
    }}));
    before = discovery.length;
    await page.reload(); await homeReady(); await dataset();
    await page.getByRole('button', {name:'Download and build', exact:true}).click();
    await page.getByRole('button', {name:'Build or resume', exact:true}).click();
    await page.locator('.workspace-jobs').waitFor();
    await home();
    assert(discovery.length === before + 1, 'An unfinished operation should not repeat discovery when returning home.');
    completed = true;
    await page.locator('.dataset-sidebar').getByRole('button', {name:/^Navigation fixture /}).waitFor();
    await homeReady();
    assert(discovery.length === before + 2, 'A completed build must refresh the library once.');
    checks.push('A build completing after leaving management updates the cached library');
    assert(!errors.length, errors.join('\n'));
    return {status:'passed',checks,source_families:families,page_errors:errors};
  } catch (error) {
    return {status:'failed',error:String(error),url:page.url(),checks,discovery_requests:discovery,page_errors:errors};
  } finally {
    await extraPage?.close();
    await page.unrouteAll({behavior:'wait'});
    page.off('pageerror', onError); page.off('request', onRequest);
  }
}
