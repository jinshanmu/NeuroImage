async page => {
  // Playwright CLI regression check: use an isolated profile and the local workspace.
  // Read-only navigation and discovery recovery; no source acquisition or build is started.
  const origin = new URL(page.url()).origin, checks = [], errors = [], discovery = [], operations = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const retiredDatasets = ['ixi_mra','hba_native','mesoveins','venat','mouches_arteries',
    'inner_ear_ct_specimen1','topcow2024','topbrain2025','tcia_cases','msd_brain_tumour'];
  const retiredFamilies = ['IXI','HumanBrainAtlas','Meso-vein MRI','VENAT','Arterial occurrence atlas'];
  const onError = error => errors.push(String(error));
  const onRequest = request => {
    if (new URL(request.url()).pathname === '/api/workspace/browse') discovery.push(request.url());
    if (/^\/api\/workspace\/jobs(?:\/|$)/.test(new URL(request.url()).pathname)) operations.push(request.url());
  };
  page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', onError); page.on('request', onRequest);
  const homeReady = async (target = page) => {
    await target.locator('.anatomy-home').waitFor();
    await target.waitForFunction(() => {
      const controls = [...document.querySelectorAll('.anatomy-grid button.anatomy-entry')];
      return controls.length > 0 && controls.every(control => !control.disabled) ||
        !!document.querySelector('.dataset-detail .dataset-atlases');
    });
    await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const ready = async () => {
    await page.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"],[role=alert],.load-error').first().waitFor();
    assert(!await page.locator('[role=alert],.load-error').count(), 'The atlas reported a viewer error.');
    assert(await page.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"]').count() === 1, 'The atlas did not become ready.');
    assert(!await page.locator('.dataset-details-link,.scene-toolbar,.interaction-hint,.live-status').count(), 'The atlas retained its removed footer.');
  };
  const home = async () => {
    await page.getByRole('link', {name:'NeuroImage home', exact:true}).click();
    await homeReady();
  };
  const dataset = async (name = 'CerebrA') => {
    await page.locator('.dataset-sidebar').getByRole('button', {name,exact:true}).click();
    await homeReady();
    const detail = page.locator('.dataset-detail');
    await detail.getByRole('heading', {name:'About this dataset',exact:true}).waitFor();
    await detail.locator('.dataset-case-grid').waitFor();
    assert(await detail.getByText('Source coverage and coordinates', {exact:true}).count() > 0,
      name + ': dataset source information is missing.');
    assert(await page.locator('.anatomy-grid .anatomy-entry,.dataset-configurations').count() === 0,
      name + ': dataset details still require a configuration or anatomy-group step.');
    assert(await page.getByRole('button', {name:'Back to anatomy groups',exact:true}).count() === 0,
      name + ': a dataset page still shows the anatomy-group back button.');
    assert(await page.getByRole('button', {name:'Download and build',exact:true}).count() === 0 &&
      await detail.locator('.dataset-manage-button').count() === 0,
      name + ': a dataset page still exposes installation controls.');
    return detail;
  };
  let extraPage;
  try {
    const initialResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace/browse');
    await page.goto(origin + '/?view=anatomy');
    const library = await (await initialResponse).json();
    await homeReady();
    assert(![...library.sources,...library.packages].some(item => {
      const id = item.id ?? item.dataset_id ?? '';
      return retiredDatasets.includes(id) || id.toLowerCase().startsWith('nextbrain');
    }),
      'A retired imaging dataset remains in the current source library.');
    for (const name of retiredFamilies)
      assert(await page.locator('.dataset-sidebar').getByRole('button', {name,exact:true}).count() === 0,
        name + ': a retired dataset remains in the sidebar.');
    const families = await page.locator('.dataset-row').count();
    assert(discovery.length === 1, 'Opening a page must check the library once.');
    assert(!await page.getByRole('banner').getByRole('button', {name:'Browse anatomy', exact:true}).count(), 'The redundant header button remains.');
    await page.getByRole('button', {name:'Explore details for Cerebral cortex', exact:true}).click();
    await page.getByRole('button', {name:'Back to anatomy groups',exact:true}).waitFor();
    await home();
    await dataset();
    const restoredCatalog = page.waitForResponse(response => new URL(response.url()).pathname === '/api/atlases');
    await page.evaluate(() => {
      history.pushState(null, '', '/?view=workspace&dataset=cerebra');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await (await restoredCatalog).finished();
    await page.waitForURL(url => url.searchParams.get('view') === 'anatomy' && url.searchParams.get('dataset') === 'cerebra');
    await homeReady();
    await page.locator('.dataset-detail').getByRole('heading', {name:'About this dataset',exact:true}).waitFor();
    assert(await page.getByRole('button', {name:'Back to anatomy groups',exact:true}).count() === 0 &&
      await page.getByRole('button', {name:'Download and build',exact:true}).count() === 0,
      'A legacy workspace URL restored obsolete dataset controls.');
    await page.goBack(); await homeReady();
    await home();
    assert(discovery.length === 1, 'Group, dataset or legacy-route navigation repeated discovery.');
    assert(await page.locator('.dataset-row').count() === families, 'Dataset navigation lost a source family.');
    checks.push('Detailed groups retain back navigation; dataset pages and legacy workspace URLs show read-only details without repeated discovery');

    for (const [name, cases, atlases] of [
      ['MUG500+', 1, 2], ['BigBrain', 1, 2], ['HCP1065', 1, 2], ['THU Cerebral MRA', 8, 8],
    ]) {
      const detail = await dataset(name);
      assert(await detail.locator('.dataset-case').count() === cases,
        name + ': representations have been mistaken for separate cases.');
      const buttons = detail.locator('.dataset-atlas-button');
      assert(await buttons.count() === atlases, name + ': a configured atlas is missing.');
      assert(await buttons.evaluateAll(items => items.every(item =>
        (item.getAttribute('aria-label') ?? item.textContent ?? '').trim().startsWith('Open '))),
        name + ': atlas buttons need a direct, explicit opening action.');
    }
    const subcortical = await dataset('CIT168');
    await subcortical.getByRole('button', {name:'Open Complete atlas',exact:true}).click();
    await ready();
    const opened = new URL(page.url()).searchParams;
    assert(!opened.has('group') && opened.get('atlas')?.startsWith('cit168_native-'),
      'The CIT168 dataset did not open its complete atlas directly.');
    assert(await page.getByText('Sources and coordinates', {exact:true}).count() === 0,
      'Dataset references remain duplicated below the viewer.');
    assert(!await page.getByRole('button', {name:'Dataset details',exact:true}).count(), 'The formal atlas retained the Dataset details shortcut.');
    await home();
    await dataset('CIT168');
    await home();
    assert(discovery.length === 1, 'Case browsing or direct atlas opening repeated source discovery.');
    checks.push('Dataset introductions group real cases and open complete atlases without anatomy-group navigation');

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
    assert(!await page.getByText('Loading', {exact:true}).count(), 'Returning home still shows a loading message.');
    checks.push('2D/3D atlas navigation and browser history reuse the library');

    assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'Refresh',exact:true}).count() === 0,
      'The retired dataset-sidebar refresh control returned.');
    await page.reload(); await homeReady();
    assert(discovery.length === 2, 'Reloading the page must check once again.');
    extraPage = await page.context().newPage();
    let newPageChecks = 0;
    extraPage.on('request', request => { if (new URL(request.url()).pathname === '/api/workspace/browse') newPageChecks++; });
    await extraPage.goto(origin + '/?view=anatomy'); await homeReady(extraPage);
    assert(newPageChecks === 1, 'A new tab must have its own initial discovery.');
    await extraPage.close(); extraPage = undefined;
    await page.screenshot({path:'output/playwright/home-navigation.png', fullPage:true});
    checks.push('Page reload and a new tab each check once without redundant dataset controls');

    let fail = true, before = discovery.length;
    await page.route(url => url.pathname === '/api/workspace/browse', async route => {
      await route.fulfill({status:fail ? 503 : 200, json:fail ? {error:'Simulated library failure'} : library});
    });
    await page.reload();
    await page.getByRole('alert').filter({hasText:'Simulated library failure'}).waitFor();
    assert(await page.getByRole('button', {name:'Refresh sources', exact:true}).isEnabled(),
      'A failed source check cannot be retried.');
    fail = false;
    await page.getByRole('button', {name:'Refresh sources', exact:true}).click(); await homeReady();
    assert(discovery.length === before + 2 && discovery.at(-1).endsWith('?refresh=1'),
      'A failed check must retry with exactly one refreshed discovery.');
    await home();
    assert(discovery.length === before + 2, 'Successful recovery was not retained.');
    fail = true;
    await page.reload();
    await page.getByRole('alert').filter({hasText:'Simulated library failure'}).waitFor();
    await page.getByRole('button', {name:'Dismiss', exact:true}).click();
    assert(await page.getByRole('alert').count() === 0, 'A source error could not be dismissed.');
    fail = false;
    await page.reload(); await homeReady();
    assert(discovery.length === before + 4, 'Dismissing an error prevented later recovery.');
    checks.push('Failed discovery can be dismissed, retried and reused');
    await page.unrouteAll({behavior:'wait'});

    for (const bookmark of ['/?view=atlas&atlas=venat-preserved-version', '/?view=anatomy&dataset=family%3Avenat']) {
      await page.goto(origin + bookmark); await homeReady();
      const route = new URL(page.url()).searchParams;
      assert(route.get('view') === 'anatomy' && !route.has('atlas') && !route.has('dataset'),
        'A retired VENAT bookmark did not return to the available anatomy library.');
      assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'VENAT',exact:true}).count() === 0,
        'A retired VENAT bookmark restored its dataset entry.');
    }
    checks.push('Retired VENAT atlas and dataset bookmarks return to the current library');
    assert(!errors.length, errors.join('\n'));
    assert(!operations.length, 'Read-only browsing requested installation jobs: ' + operations.join('\n'));
    return {status:'passed',checks,source_families:families,page_errors:errors,installation_requests:operations};
  } catch (error) {
    return {status:'failed',error:String(error),url:page.url(),checks,discovery_requests:discovery,page_errors:errors,installation_requests:operations};
  } finally {
    await extraPage?.close();
    await page.unrouteAll({behavior:'wait'});
    page.off('pageerror', onError); page.off('request', onRequest);
  }
}
