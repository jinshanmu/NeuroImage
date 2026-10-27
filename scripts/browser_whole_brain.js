async page => {
  const origin = new URL(page.url()).origin;
  const assert = (value, message) => { if (!value) throw Error(message); };
  const errors = [], results = [];
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  const expected = ['spl_nac', 'cerebra', 'mida'];
  const excludedIdentity = value => typeof value === 'string' &&
    /^(?:nextbrain|(?:ixi|hba|humanbrainatlas|mesoveins|venat|mouches|arterial_occurrence)(?:$|[_-]))/i.test(value);
  const isExcluded = item => [item.id, item.dataset_id, item.package_id, item.key,
    ...(item.sources ?? []).map(source => source.id)].some(excludedIdentity);
  const datasets = items => [...new Set(items.filter(item => item.coverage?.some(group => group.id === 'general-anatomy')).map(item => item.dataset_id))].sort();
  const ready = async (expectedWarning = '') => {
    await page.waitForFunction(expectedWarning => !!document.querySelector('.canvas-shell[data-ready="true"]') ||
      !!document.querySelector('.load-error') || [...document.querySelectorAll('[role=alert]')]
        .some(alert => !expectedWarning || !alert.textContent?.includes(expectedWarning)), expectedWarning, {timeout:120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.locator('.canvas-shell[data-ready="true"]').count() === 1,
      'The whole-brain canvas did not become ready.');
    assert(await page.locator('.load-error').count() === 0, 'A whole-brain source failed to load.');
    const warnings = await page.getByRole('alert').allTextContents();
    assert(warnings.every(warning => expectedWarning && warning.includes(expectedWarning)),
      'A viewer error is visible: ' + warnings.join(' · '));
  };
  try {
    const atlases = (await (await page.request.get(origin + '/api/atlases')).json()).atlases;
    const catalog = await (await page.request.get(origin + '/api/workspace/browse')).json();
    assert(![...atlases, ...catalog.packages, ...catalog.sources].some(isExcluded),
      'An excluded source remains discoverable in the active atlas, stored package or source catalog.');
    assert(JSON.stringify(datasets(atlases)) === JSON.stringify([...expected].sort()), 'The active catalog offers an incomplete whole-brain source.');
    assert(JSON.stringify(datasets(catalog.packages)) === JSON.stringify([...expected].sort()), 'Historical packages bypass whole-brain coverage requirements.');
    for (const dataset of expected) {
      await page.goto(origin + '/?view=anatomy');
      const source = page.getByRole('combobox', {name:'Source for Whole brain',exact:true});
      await source.waitFor();
      assert((await page.locator('.brand').textContent()).replace(/\s+/g, ' ').includes('NEUROANATOMY WORKSPACE'),
        'The workspace brand did not update.');
      assert(await page.locator('.anatomy-home-heading .eyebrow,.home-evidence-note').count() === 0,
        'The main anatomy page still renders a retired eyebrow or footer sentence.');
      assert(await page.getByText('Select a dataset to browse its cases, regions and available source representations.', {exact:true}).count() === 0,
        'The dataset sidebar still renders its retired footer sentence.');
      assert(await page.locator('.anatomy-card .anatomy-entry p,.anatomy-card .source-coverage-note').count() === 0,
        'The whole-brain card still renders a long description or coverage note.');
      assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'Refresh',exact:true}).count() === 0,
        'The dataset sidebar still renders its Refresh button.');
      assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'NextBrain',exact:true}).count() === 0,
        'The excluded NextBrain family remains in the dataset sidebar.');
      const options = await source.locator('option').evaluateAll(items => items.map(item => item.value));
      assert(JSON.stringify(options) === JSON.stringify(expected), 'The whole-brain selector has unexpected sources.');
      await source.selectOption(dataset);
      await page.getByRole('button', {name:'Browse Whole brain',exact:true}).click();
      await ready();
      assert(await page.getByRole('heading', {name:'Whole brain',exact:true}).count() === 1, 'Whole-brain navigation lost its scope.');
      assert(await page.locator('.source-coverage-note').count() === 0,
        'The whole-brain heading still renders a source coverage paragraph.');
      const openedKey = new URL(page.url()).searchParams.get('atlas');
      const opened = [...atlases, ...catalog.packages].find(item => item.key === openedKey);
      const expectedNote = opened?.coverage.find(item => item.id === 'general-anatomy')?.coverage_note?.trim();
      assert(expectedNote, 'The whole-brain source lost its API coverage description.');
      const expectedVisible = [...new Set(opened.coverage.find(item => item.id === 'general-anatomy').structure_ids ?? [])].sort();
      const manifestResponse = await page.request.get(origin + '/atlas/' + encodeURIComponent(openedKey) + '/manifest.json');
      assert(manifestResponse.ok(), 'The exact whole-brain source manifest is unavailable.');
      const manifest = await manifestResponse.json();
      const sourceIds = manifest.structures.map(item => item.id).sort();
      assert(expectedVisible.length > 0 && expectedVisible.every(id => sourceIds.includes(id)), 'Whole-brain coverage names unavailable source structures.');
      const libraryOrder = [
        ...manifest.structures.filter(item => expectedVisible.includes(item.id)),
        ...manifest.structures.filter(item => !expectedVisible.includes(item.id)),
      ];
      assert(await page.getByRole('alert').count() === 0, 'A whole-brain source failed to open.');
      const library = page.getByRole('region', {name:'Primary atlas workspace',exact:true}).getByRole('button', {name:'Structure library',exact:true});
      await library.click();
      assert(await library.getAttribute('aria-expanded') === 'true', 'The structure library toggle did not open its sidebar.');
      const toggles = page.locator('.structure-row input[type=checkbox]');
      await toggles.first().waitFor();
      await page.waitForFunction(count => document.querySelectorAll('.structure-row').length === count, manifest.structures.length);
      const rows = await page.locator('.structure-row').evaluateAll(items => items.map(row => ({
        id:row.querySelector('button[title]')?.getAttribute('title'),checked:row.querySelector('input[type=checkbox]')?.checked,
        name:row.querySelector('button')?.getAttribute('aria-label'),group:row.querySelector('button small')?.textContent?.trim(),
        selected:row.classList.contains('selected'),
      })));
      assert(JSON.stringify(rows.map(row => row.id)) === JSON.stringify(libraryOrder.map(item => item.id)), 'Whole-brain entry did not list its complete source in group-first source order.');
      assert(rows.every((row,index) => row.name === libraryOrder[index].name &&
        row.group === (expectedVisible.includes(row.id) ? 'Whole brain' : 'Background')), 'Whole-brain library lost source names or group attributions.');
      const visibleIds = rows.filter(row => row.checked).map(row => row.id).sort();
      assert(JSON.stringify(visibleIds) === JSON.stringify(expectedVisible), 'Whole-brain initial visibility differs from its exact declared scope.');
      const selectedRows = rows.filter(row => row.selected);
      assert(selectedRows.length === 1 && selectedRows[0].id === libraryOrder[0].id, 'Whole-brain entry did not select its first group row.');
      const actualPoint = await page.locator('.coordinate-bar input').evaluateAll(inputs => inputs.map(input => Number(input.value)));
      assert(JSON.stringify(actualPoint) === JSON.stringify(libraryOrder[0].target_ras_mm.map(value => Number(value.toFixed(2)))),
        'Whole-brain default cursor does not retain its first group row source target.');
      assert(await page.getByRole('combobox',{name:'Anatomy category',exact:true}).inputValue() === 'group', 'Whole-brain batch target did not default to its current group.');
      assert(await page.getByText(expectedVisible.length + ' of ' + manifest.structures.length + ' structures shown',{exact:true}).count() === 1,
        'Whole-brain count does not retain its complete source total.');
      results.push({dataset,status:'passed',structures:rows.length,shown:visibleIds.length,api_coverage_note:expectedNote});
      assert(await library.getAttribute('aria-expanded') === 'true', 'The structure library closed before its toggle was used.');
      await library.click();
      assert(await library.getAttribute('aria-expanded') === 'false', 'The structure library toggle did not close its sidebar.');
    }
    const block = atlases.find(item => item.dataset_id === 'cit168_native');
    assert(block, 'Serve the supported regional CIT168 source for bookmark recovery.');
    await page.goto(origin + '/?view=atlas&atlas=' + block.key + '&group=general-anatomy');
    await ready('does not supply the selected whole-brain atlas');
    assert((await page.getByRole('alert').textContent()).includes('does not supply the selected whole-brain atlas'), 'An old whole-brain bookmark silently reclassified a regional source.');
    assert(!new URL(page.url()).searchParams.has('group'), 'The incorrect whole-brain scope remained in the bookmark.');
    assert(await page.getByRole('heading', {name:block.title,exact:true}).count() === 1, 'The original regional source was lost.');
    await page.reload(); await ready();
    assert(await page.getByRole('alert').count() === 0, 'The corrected regional bookmark still fails.');
    await page.locator('a.brand').click();
    await page.getByRole('combobox', {name:'Source for Whole brain',exact:true}).waitFor();
    assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'CIT168',exact:true}).count() === 1,
      'Supported regional datasets disappeared after bookmark recovery.');
    assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'NextBrain',exact:true}).count() === 0,
      'The excluded NextBrain family returned after bookmark recovery.');
    await page.screenshot({path:'output/playwright/whole-brain-sources-corrected.png',fullPage:true});
    assert(!errors.length, errors.join('\n'));
    return {status:'passed',whole_brain_sources:results,regional_bookmark_recovery:'passed',page_errors:errors};
  } finally {
    page.off('pageerror', onError);
  }
}
