async page => {
  // Run against the local workspace with Playwright CLI in an isolated profile.
  // Optional ?groups-from=0&groups-count=3 checks a bounded group batch.
  const initialUrl = new URL(page.url()), origin = initialUrl.origin;
  const offset = Number(initialUrl.searchParams.get('groups-from') ?? 0);
  const limit = Number(initialUrl.searchParams.get('groups-count') ?? 9);
  const groups = [
    {id:'cerebral-cortex',title:'Cerebral cortex',sources:['spl_nac','cerebra','julich_selected','bigbrain_layers','z_anatomy']},
    {id:'deep-nuclei',title:'Deep nuclei',sources:['spl_nac','cerebra','cit168_native','mida','julich_selected','z_anatomy']},
    {id:'white-matter-pathways',title:'White-matter pathways',sources:['hcp1065_tracts','hcp1065_prob','z_anatomy']},
    {id:'ventricles',title:'Ventricles and cisterns',coverageIds:['ventricles','cisternal-regions'],sources:['spl_nac','cerebra','mida','z_anatomy']},
    {id:'brainstem',title:'Brainstem',sources:['spl_nac','cerebra','brainstem_navigator_mni','mida','z_anatomy']},
    {id:'cerebellum',title:'Cerebellum',sources:['spl_nac','cerebra','mida','suit_cerebellum','z_anatomy']},
    {id:'cranial-nerves',title:'Cranial nerves',sources:['mida','hcp1065_tracts','z_anatomy']},
    {id:'vascular-anatomy',title:'Arteries and veins',sources:['mida','z_anatomy','thu_mra_case009','thu_mra_case001','thu_mra_case030','thu_mra_case006','thu_mra_case007','thu_mra_case010','thu_mra_case014','thu_mra_case021']},
    {id:'skull-base-context',title:'Skull base',sources:['mida','z_anatomy']},
  ];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const uniqueSorted = items => [...new Set(items)].sort();
  const sameSources = (actual, expected) => JSON.stringify(uniqueSorted(actual)) === JSON.stringify(uniqueSorted(expected));
  const datasets = (items, group) => uniqueSorted(items.filter(item => item.coverage?.some(coverage =>
    (group.coverageIds ?? [group.id]).includes(coverage.id))).map(item => item.dataset_id));
  const noteFor = (item, group) => [...new Set((item.coverage ?? [])
    .filter(coverage => (group.coverageIds ?? [group.id]).includes(coverage.id))
    .map(coverage => coverage.coverage_note?.trim()).filter(Boolean))].join(' ');
  const retiredDatasets = ['ixi_mra','hba_native','mesoveins','venat','mouches_arteries'];
  const retiredFamilyTitles = ['NextBrain','IXI','HumanBrainAtlas','Meso-vein MRI','VENAT','Arterial occurrence atlas'];
  const excludedIdentity = value => typeof value === 'string' &&
    /^(?:nextbrain|(?:ixi|hba|humanbrainatlas|mesoveins|venat|mouches|arterial_occurrence)(?:$|[_-]))/i.test(value);
  const isExcluded = item => [item.id, item.dataset_id, item.package_id, item.key,
    ...(item.sources ?? []).map(source => source.id)].some(excludedIdentity);
  const errors = [], results = [], checks = [];
  const onError = error => errors.push(String(error));
  let phase = 'catalog', regionalTopic;
  page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', onError);
  const homeReady = async () => {
    await page.locator('.anatomy-home').waitFor();
    await page.locator('.anatomy-grid button.anatomy-entry').first().waitFor();
    await page.waitForFunction(() => {
      const controls = [...document.querySelectorAll('.anatomy-grid select,.anatomy-grid button.anatomy-entry')];
      return controls.length > 0 && controls.every(control => !control.disabled);
    });
    assert(await page.getByRole('alert').count() === 0, 'The anatomy browser reported an error.');
    assert(await page.locator('.anatomy-card .anatomy-entry p,.anatomy-card .source-coverage-note').count() === 0,
      'An anatomy card still renders a long description or coverage note.');
    for (const name of retiredFamilyTitles)
      assert(await page.locator('.dataset-sidebar').getByRole('button', {name,exact:true}).count() === 0,
        'An excluded family remains in the dataset sidebar: ' + name);
    assert(await page.locator('.anatomy-grid select option').evaluateAll((options, retired) =>
      options.every(option => !/^nextbrain/i.test(option.value) && !retired.includes(option.value)), retiredDatasets),
      'An anatomy selector still offers an excluded source.');
  };
  const ready = async () => {
    await page.waitForFunction(() => !!document.querySelector('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"],[role=alert],.load-error'));
    assert(await page.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"]').count() === 1, 'The group source did not become ready.');
    assert(await page.locator('.load-error').count() === 0, 'The group source failed to load.');
    assert(await page.locator('.dataset-details-link,.scene-toolbar,.interaction-hint,.live-status').count() === 0, 'The group source retained a removed footer.');
    assert(await page.getByRole('alert').count() === 0,
      'A group source failed to open: ' + (await page.getByRole('alert').allTextContents()).join(' · '));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  try {
    assert(Number.isInteger(offset) && offset >= 0 && offset < groups.length, 'groups-from must be an integer from 0 to 8.');
    assert(Number.isInteger(limit) && limit > 0, 'groups-count must be a positive integer.');
    const [activeResponse, browseResponse] = await Promise.all([
      page.request.get(origin + '/api/atlases'), page.request.get(origin + '/api/workspace/browse'),
    ]);
    assert(activeResponse.ok() && browseResponse.ok(), 'The local source catalogs are unavailable.');
    const atlases = (await activeResponse.json()).atlases;
    const catalog = await browseResponse.json();
    assert(![...atlases, ...catalog.packages, ...catalog.sources].some(isExcluded),
      'An excluded source remains discoverable in the active atlas, stored package or source catalog.');
    const packages = catalog.packages.filter(item => item.status === 'available');
    for (const group of groups.slice(offset, offset + limit)) {
      phase = group.id;
      const activeSources = datasets(atlases, group), availableSources = datasets(packages, group);
      assert(sameSources(activeSources, group.sources), group.title + ': unexpected active API sources: ' + activeSources.join(', '));
      assert(sameSources(availableSources, group.sources), group.title + ': historical packages bypass the group scope: ' + availableSources.join(', '));
      await page.goto(origin + '/?view=anatomy'); await homeReady();
      const source = page.getByRole('combobox', {name:'Source for ' + group.title,exact:true});
      await source.waitFor();
      const offered = await source.locator('option').evaluateAll(options => options.map(option => option.value));
      assert(sameSources(offered, group.sources) && offered.length === group.sources.length,
        group.title + ': unexpected source selector entries: ' + offered.join(', '));
      const defaultSource = await source.inputValue(), notices = [];
      assert(group.sources.includes(defaultSource), group.title + ': the default source is outside its group.');
      for (const dataset of offered) {
        const matching = [...packages, ...atlases].filter(item => item.dataset_id === dataset &&
          item.coverage?.some(coverage => (group.coverageIds ?? [group.id]).includes(coverage.id)));
        const apiNotes = uniqueSorted(matching.map(item => noteFor(item, group)));
        assert(matching.length && apiNotes.every(Boolean), group.title + ': API coverage explanation is missing for ' + dataset + '.');
        await source.selectOption(dataset);
        assert(await page.getByLabel('Source coverage for ' + group.title, {exact:true}).count() === 0,
          group.title + ': selecting ' + dataset + ' restored a card coverage paragraph.');
        notices.push({dataset,api_coverage_notes:apiNotes});
      }
      await source.selectOption(defaultSource);
      const started = Date.now();
      await page.getByRole('button', {name:'Browse ' + group.title,exact:true}).click(); await ready();
      assert(await page.locator('.workspace-heading h1,.workspace-heading .eyebrow')
        .evaluateAll((elements, title) => elements.some(element => element.textContent?.trim() === title), group.title),
        group.title + ': opening its default source lost the group scope.');
      assert(await page.locator('.source-coverage-note').count() === 0,
        group.title + ': the atlas heading still renders a source coverage paragraph.');
      const opened = [...atlases, ...packages].find(item => item.key === new URL(page.url()).searchParams.get('atlas'));
      const apiAtlasNote = opened && noteFor(opened, group);
      assert(apiAtlasNote, group.title + ': the opened source lost its API coverage description.');
      assert(new URL(page.url()).searchParams.get('group') === group.id, group.title + ': the atlas route lost its group.');
      results.push({group:group.id,status:'passed',sources:offered,default_source:defaultSource,
        open_ms:Date.now() - started,coverage_notices:notices,api_atlas_coverage_note:apiAtlasNote});
    }
    phase = 'regional-detail-discovery';
    const blockId = 'bigbrain_hippocampus';
    const block = packages.find(item => item.dataset_id === blockId) ?? atlases.find(item => item.dataset_id === blockId);
    assert(block, 'Serve the supported BigBrain hippocampal source for regional discovery checks.');
    assert(!block.coverage?.some(coverage => groups.some(group => (group.coverageIds ?? [group.id]).includes(coverage.id))),
      'The local BigBrain hippocampal source is listed as a complete anatomical group source.');
    await page.goto(origin + '/?view=anatomy&group=cerebral-cortex'); await homeReady();
    const regionalSelectors = await page.locator('.anatomy-grid select').evaluateAll((selects, dataset) => selects
      .filter(select => [...select.options].some(option => option.value === dataset))
      .map(select => ({label:select.getAttribute('aria-label'),options:[...select.options].map(option => option.value)})), blockId);
    assert(regionalSelectors.length > 0, 'Cerebral cortex details no longer offer the BigBrain hippocampal source.');
    regionalTopic = regionalSelectors[0].label.replace(/^Source for /, '');
    await page.getByRole('combobox', {name:'Source for ' + regionalTopic,exact:true}).selectOption(blockId);
    assert(await page.getByRole('button', {name:'Browse ' + regionalTopic,exact:true}).isVisible(),
      'The BigBrain hippocampal detail cannot be opened from its parent group.');
    checks.push('Cerebral cortex details retain the supported BigBrain hippocampal source');
    await page.goto(origin + '/?view=anatomy&dataset=' + blockId);
    const datasetDetail = page.locator('.dataset-detail');
    await datasetDetail.getByRole('heading', {name:'About this dataset',exact:true}).waitFor();
    await datasetDetail.locator('.dataset-case-grid').waitFor();
    assert(await datasetDetail.locator('.dataset-case').count() === 1,
      'BigBrain representations were mistaken for separate specimens.');
    assert(await datasetDetail.locator('.dataset-atlas-button').count() === 2,
      'The BigBrain dataset page lost one of its two source atlases.');
    assert(await page.locator('.anatomy-grid .anatomy-entry').count() === 0,
      'The dataset page still inserts anatomy-group navigation before its atlases.');
    assert(await datasetDetail.getByText('Source coverage and coordinates', {exact:true}).count() > 0,
      'The dataset page lost its source scope and native coordinate definitions.');
    for (const title of ['Whole brain', ...groups.map(group => group.title)]) {
      assert(await page.getByRole('combobox', {name:'Source for ' + title,exact:true}).count() === 0,
        'The dataset page still offers the ' + title + ' group selector.');
    }
    const atlasLabel = block.dataset_info?.atlas_label;
    assert(typeof atlasLabel === 'string' && atlasLabel.length,
      'The BigBrain source catalog lacks its direct atlas label.');
    await datasetDetail.getByRole('button', {name:'Open ' + atlasLabel,exact:true}).click(); await ready();
    const regionalRoute = new URL(page.url()).searchParams;
    assert(regionalRoute.get('view') === 'atlas' && regionalRoute.get('atlas')?.startsWith(blockId + '-') && !regionalRoute.has('group'),
      'The direct dataset atlas button added an anatomical group or changed its source.');
    assert(await page.getByRole('button', {name:'Dataset details',exact:true}).count() === 0, 'The model retained the Dataset details shortcut.');
    await page.getByRole('link', {name:'NeuroImage home',exact:true}).click(); await homeReady();
    await page.locator('.dataset-sidebar').getByRole('button', {name:'BigBrain',exact:true}).click();
    await page.locator('.dataset-detail').getByRole('heading', {name:'About this dataset',exact:true}).waitFor();
    assert(await page.locator('.dataset-detail .dataset-case').count() === 1,
      'Returning from a model lost the dataset specimen grouping.');
    checks.push('Dataset details retain real case grouping, direct atlas opening and source information without anatomy groups');
    phase = 'excluded-source-bookmarks';
    const excludedKey = 'nextbrain_case1_block05-2a76e6ca515b16ef';
    const excluded = await page.request.get(origin + '/api/workspace/atlases/' + excludedKey);
    const refusal = await excluded.json();
    assert(!excluded.ok() && JSON.stringify(refusal).includes('dataset_excluded'),
      'An excluded NextBrain package can still activate or lacks an explicit exclusion response.');
    for (const id of retiredDatasets) {
      const response = await page.request.get(origin + '/api/workspace/atlases/' + id + '-preserved-version');
      assert(!response.ok() && JSON.stringify(await response.json()).includes('dataset_excluded'),
        'A retired package can still activate or lacks an explicit exclusion response: ' + id);
    }
    for (const bookmark of [
      '/?view=atlas&atlas=' + excludedKey + '&group=general-anatomy',
      '/?view=anatomy&dataset=nextbrain_case1_block07',
      '/?view=anatomy&dataset=family%3Anextbrain',
    ]) {
      await page.goto(origin + bookmark); await homeReady();
      const route = new URL(page.url()).searchParams;
      assert(route.get('view') === 'anatomy' && !route.has('atlas') && !route.has('dataset'),
        'A retired NextBrain bookmark did not return to the available anatomy catalog.');
      assert(await page.getByRole('combobox', {name:'Source for Whole brain',exact:true}).isVisible(),
        'A retired NextBrain bookmark left the current atlas catalog inaccessible.');
    }
    checks.push('NextBrain activation is refused and retired source/family bookmarks return to the current catalog');
    assert(!errors.length, errors.join('\n'));
    return {status:'passed',offset,total_groups:groups.length,checked:results.length,results,
      checks,regional_dataset:blockId,regional_cortical_topic:regionalTopic,page_errors:errors};
  } catch (error) {
    return {status:'failed',error:String(error),phase,url:page.url(),offset,total_groups:groups.length,
      checked:results.length,results,checks,regional_cortical_topic:regionalTopic,page_errors:errors};
  } finally {
    page.off('pageerror', onError);
  }
}
