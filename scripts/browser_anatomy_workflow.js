async page => {
  const origin = new URL(page.url()).origin;
  const assert = (value, message) => { if (!value) throw Error(message); };
  const errors = [], retiredRequests = [], discovery = [], operations = [], checks = [];
  page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  const onError = error => errors.push(String(error));
  const onRequest = request => {
    if (/\/api\/workspace\/(?:teaching|courses|content)(?:\/|$)|\/lessons\.json(?:\?|$)/.test(request.url())) retiredRequests.push(request.url());
    const path = new URL(request.url()).pathname;
    if (path === '/api/workspace/browse') discovery.push(request.url());
    if (/^\/api\/workspace\/jobs(?:\/|$)/.test(path)) operations.push(request.url());
  };
  page.on('pageerror', onError); page.on('request', onRequest);
  const catalog = await (await page.request.get(origin + '/api/workspace/browse')).json();
  const latest = id => catalog.packages.filter(item => item.dataset_id === id && item.status === 'available').sort((a,b) => b.created_utc.localeCompare(a.created_utc))[0];
  const primary = latest('cerebra'), comparison = latest('spl_nac'), model = latest('bigbrain_hippocampus');
  assert(primary && comparison && model, 'Serve CerebrA, SPL/NAC and BigBrain hippocampal surfaces.');
  const groupId = 'cerebral-cortex';
  const coverageFor = source => [...(source.coverage ?? []), ...(source.detail_coverage ?? [])].filter(item => item.id === groupId);
  const comparisonIds = [...new Set(coverageFor(comparison).flatMap(item => item.structure_ids ?? []))].sort();
  assert(comparisonIds.length > 0, 'SPL/NAC must supply its own cerebral-cortex scope.');
  const ready = async (scope = page) => {
    await scope.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"],[role=alert],.load-error').first().waitFor();
    assert(await scope.locator('[role=alert],.load-error').count() === 0, 'The viewer failed to load.');
    assert(await scope.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"]').count() === 1, 'The viewer is not ready.');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.getByRole('alert').count() === 0, 'A viewer error is visible.');
    assert(await scope.locator('.dataset-details-link,.scene-toolbar,.interaction-hint,.live-status,input[aria-label="Import scene file"],input[aria-label="Import model scene file"]').count() === 0,
      'The formal viewer still exposes a removed footer or scene control.');
    assert(await scope.getByRole('button', {name:/^(Dataset details|Save scene|Restore saved|Export scene|Import scene|Export image|Preparing export…)$/}).count() === 0, 'The viewer retained a removed footer action.');
    assert(await scope.getByRole('checkbox', {name:'Radiological',exact:true}).count() === 0, 'The formal viewer still exposes a convention switch.');
    assert(await scope.getByRole('button', {name:/^(Full sections|Magnify at cursor)$/}).count() === 0,
      'The formal viewer retained a redundant 2D zoom action.');
    if (await scope.locator('.canvas-shell[data-ready="true"]').count()) {
      const navigation = scope.locator('.view-coordinate-bar');
      assert(await navigation.count() === 1, 'The image settings and coordinates are not grouped below the canvas.');
      const navigationOrder = await navigation.evaluate(bar => Array.from(bar.children).map(child =>
        child.matches('.view-toolbar.view-settings') ? 'settings' : child.matches('.coordinate-bar') ? 'coordinates' :
          child.matches('button.reset-view') ? 'reset' : 'unexpected'));
      assert(JSON.stringify(navigationOrder) === JSON.stringify(['settings', 'coordinates', 'reset']),
        'Image, Layout and Panels must precede RAS, with Reset view after the coordinates.');
      assert(await navigation.getByRole('button', {name:'Reset view',exact:true}).count() === 1,
        'The coordinate row lost Reset view.');
      assert(await scope.locator('.cursor-readout .coordinate-status').count() === 1 &&
        await scope.locator('.coordinate-status').count() === 1 && await scope.locator('.compact-selection').count() === 0,
        'The image workspace must show the cursor name once.');
      assert(await navigation.evaluate(bar => {
        const column = bar.closest('.viewer-column'), readout = column?.querySelector('.cursor-readout'), canvas = column?.querySelector('.canvas-shell');
        return !!(readout && canvas && (readout.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          (canvas.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING));
      }), 'The cursor name must precede the canvas, with image settings and RAS below it.');
      const layouts = scope.getByRole('combobox', {name:'View layout',exact:true});
      assert(await navigation.locator('.view-settings').getByRole('combobox', {name:'View layout',exact:true}).count() === 1,
        'The Layout selector is outside the image-settings group.');
      const settingNames = await navigation.locator('.view-settings select').evaluateAll(selects => selects.map(select => select.getAttribute('aria-label')));
      const currentLayout = await layouts.inputValue();
      assert(['MRI contrast', 'CT image', 'Reference model', 'Scalar field'].includes(settingNames[0]) &&
        settingNames[1] === 'View layout' && settingNames.length === (currentLayout === 'quad' ? 3 : 2) &&
        (currentLayout !== 'quad' || settingNames[2] === 'Image panel arrangement'),
        'Image, Layout and optional Panels are not ordered together before RAS.');
      const layoutValues = await layouts.locator('option').evaluateAll(options => options.map(option => option.value));
      assert(JSON.stringify(layoutValues) === JSON.stringify(['quad', 'axial', 'coronal', 'sagittal', '3d']),
        'The formal viewer lost a supported view or retained the retired equal layout.');
      assert(await layouts.locator('option').filter({hasText:'Equal 2D + 3D'}).count() === 0, 'The retired equal layout remains selectable.');
      const zoomControls = scope.locator('.display-controls .zoom-controls');
      assert(await zoomControls.count() === 1, 'The 2D and 3D zoom sliders are not grouped below the canvas.');
      const zoomOrder = await zoomControls.locator('input[type=range]').evaluateAll(sliders => sliders.map(slider => slider.getAttribute('aria-label')));
      assert(JSON.stringify(zoomOrder) === JSON.stringify(['2D zoom', '3D zoom']), 'The 2D zoom slider must precede the 3D zoom slider in their shared group.');
      const zoomRanges = await zoomControls.locator('input[type=range]').evaluateAll(sliders => sliders.map(slider =>
        [Number(slider.min), Number(slider.max), Number(slider.step)]));
      assert(zoomRanges.every(range => JSON.stringify(range) === '[1,10,0.1]'),
        'Both zoom sliders must offer 1–10 in 0.1 increments.');
      assert(await scope.locator('.section-navigation').count() === 0, 'The old above-canvas zoom row remains.');
    }
    assert(await scope.locator('.source-coverage-note').count() === 0, 'The viewer retained a source coverage paragraph below its heading.');
    assert(await scope.getByRole('button', {name:/^(Expand viewer|Exit expanded view)$/}).count() === 0,
      'The formal viewer still exposes an expanded-view action.');
    assert(await page.getByRole('dialog', {name:'Expanded atlas viewer',exact:true}).count() === 0 &&
      await scope.locator('.workspace.expanded').count() === 0, 'The formal viewer retained an expanded-view mode.');
  };
  const coordinates = scope => scope.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value));
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  try {
    await page.goto(origin + '/?view=teaching&course=retained-historical-course');
    await page.getByRole('heading',{name:'Browse anatomy',exact:true}).waitFor();
    await page.waitForURL(origin + '/?view=anatomy');
    assert(!await page.getByRole('button',{name:'Teaching library',exact:true}).count(), 'Retired navigation remains.');
    checks.push('Legacy teaching links return to anatomy');
    const legacyDiscovery = page.waitForResponse(response => new URL(response.url()).pathname === '/api/workspace/browse');
    await page.goto(origin + '/?view=workspace&dataset=cerebra');
    await (await legacyDiscovery).finished();
    await page.waitForURL(url => url.searchParams.get('view') === 'anatomy' && url.searchParams.get('dataset') === 'cerebra');
    assert(!await page.getByRole('button',{name:/prepare.*(?:teaching|course|notebook)/i}).count(), 'Retired job controls remain.');
    assert(new URL(page.url()).searchParams.get('dataset') === 'cerebra', 'Dataset navigation was lost.');
    const datasetDetail = page.locator('.dataset-detail');
    await datasetDetail.getByRole('heading',{name:'About this dataset',exact:true}).waitFor();
    await datasetDetail.locator('.dataset-case-grid').waitFor();
    await page.getByText('Loading',{exact:true}).waitFor({state:'hidden'});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await datasetDetail.locator('.dataset-atlas-button').count() === 1,
      'The legacy workspace URL did not open the direct atlas choice.');
    assert(await page.locator('.anatomy-grid .anatomy-entry,.dataset-configurations').count() === 0,
      'The legacy workspace URL opened an intermediate configuration or anatomy-group page.');
    assert(await page.getByRole('button',{name:'Back to anatomy groups',exact:true}).count() === 0 &&
      await page.getByRole('button',{name:'Download and build',exact:true}).count() === 0 &&
      await page.locator('.dataset-manage-button,.workspace-jobs').count() === 0,
      'Dataset details still expose management or anatomy-group back controls.');
    await datasetDetail.locator('.dataset-references > summary').click();
    assert(await datasetDetail.getByRole('link',{name:'Official source ↗',exact:true}).count() > 0,
      'Dataset details lost the source references.');
    assert(await datasetDetail.locator('.dataset-reference-links a').evaluateAll(links =>
      links.every(link => !!link.getAttribute('href') && !link.getAttribute('href').includes('undefined'))),
      'Dataset details contain an invalid source or license link.');
    const discovered = discovery.length;
    await page.getByRole('link',{name:'NeuroImage home',exact:true}).click();
    await page.getByRole('heading',{name:'Browse anatomy',exact:true}).waitFor();
    await page.locator('.dataset-sidebar').getByRole('button',{name:'CerebrA',exact:true}).click();
    await datasetDetail.getByRole('heading',{name:'About this dataset',exact:true}).waitFor();
    assert(discovery.length === discovered, 'Home and dataset navigation repeated library discovery.');
    assert(await page.getByRole('button',{name:'Back to anatomy groups',exact:true}).count() === 0 &&
      await page.getByRole('button',{name:'Download and build',exact:true}).count() === 0,
      'Returning to a dataset restored obsolete controls.');
    checks.push('Legacy workspace links open read-only dataset details with source and license links; ordinary navigation reuses discovery');
    await page.goto(origin + '/?view=atlas&atlas=' + primary.key + '&group=' + groupId); await ready();
    const original = await coordinates(page);
    assert(Number(await page.getByRole('slider',{name:'2D overlay',exact:true}).inputValue()) === .5 &&
      Number(await page.getByRole('slider',{name:'3D opacity',exact:true}).inputValue()) === .5,
      'New image views must start both overlay and 3D opacity at fifty percent.');
    const background2D = page.getByRole('slider',{name:'2D background',exact:true});
    const background3D = page.getByRole('slider',{name:'3D background',exact:true});
    assert(Number(await background2D.inputValue()) === 1,'2D background did not retain its initial full opacity.');
    assert(Number(await background3D.inputValue()) === 0 && await background3D.isEnabled(),'3D background did not start at zero with an available slider.');
    await background2D.press('Home'); await ready();
    assert(Number(await background2D.inputValue()) === 0 && Number(await background3D.inputValue()) === 0,'Closing the 2D background changed the 3D background.');
    await background3D.press('ArrowRight'); await ready();
    assert(Number(await background3D.inputValue()) === .05 && Number(await background2D.inputValue()) === 0,'Increasing the 3D background did not enable it independently.');
    assert(same(original,await coordinates(page)),'Background changes moved the native cursor.');
    await background2D.press('End'); await ready();
    assert(Number(await background2D.inputValue()) === 1 && Number(await background3D.inputValue()) === .05,'Restoring the 2D background changed the 3D background.');
    await background3D.press('Home'); await ready();
    assert(Number(await background3D.inputValue()) === 0 && Number(await background2D.inputValue()) === 1,'Closing the 3D background changed the 2D background.');
    assert(same(original,await coordinates(page)),'Restoring background defaults moved the native cursor.');
    checks.push('Regional background sliders retain their defaults, switch off at zero and remain independent');
    assert(await page.locator('details.section-guide-controls,.section-guide-controls summary,details.anatomy-display-controls,.anatomy-display-controls details,.anatomy-display-controls summary').count() === 0,
      'Section guides or surface controls still require opening a nested menu.');
    for (const plane of ['axial','coronal','sagittal']) assert(await page.locator('.background-controls .section-guide-controls').getByRole('checkbox',{name:'Show ' + plane + ' guide',exact:true}).isVisible(),
      'The ' + plane + ' section guide is missing from the background and cursor row.');
    assert(await page.locator('.background-controls').getByRole('checkbox',{name:'Cursor',exact:true}).isVisible(), 'The linked cursor checkbox is missing from the background row.');
    assert(await page.getByRole('slider',{name:'3D opacity',exact:true}).isVisible(), 'Overall 3D opacity is not directly visible.');
    const cutButton = page.getByRole('button',{name:'Cutaway',exact:true});
    assert(await cutButton.isVisible() && await cutButton.getAttribute('aria-pressed') === 'false', 'The surface cutaway toggle did not start off.');
    assert(await page.getByRole('combobox',{name:'Surface cutaway plane',exact:true}).count() === 0, 'An inactive cutaway still shows its plane menu.');
    checks.push('Section guides, cursor visibility, cutaway and overall opacity are available without opening menus');
    await page.getByRole('checkbox',{name:'Cursor',exact:true}).uncheck();
    await cutButton.click(); await ready();
    assert(await cutButton.getAttribute('aria-pressed') === 'true', 'The surface cutaway toggle did not activate.');
    assert(same(original,await coordinates(page)),'Cutaway changed the section coordinates.');
    assert(!await page.getByRole('checkbox',{name:'Cursor',exact:true}).isChecked(), 'The cursor visibility control did not apply.');
    const cutaway = page.locator('.surface-cutaway-controls');
    assert(await cutaway.getByRole('combobox',{name:'Surface cutaway plane',exact:true}).isVisible(), 'The cutaway plane menu did not appear.');
    assert(await cutaway.locator('input[type=number],p').count() === 0 &&
      await page.getByRole('button',{name:'Move cut to cursor',exact:true}).count() === 0,
      'The dynamic cutaway retained a manual cut coordinate or explanatory paragraph.');
    const cutVisible = await page.locator('.structure-row input[type=checkbox]').evaluateAll(items => items.map(item => item.checked));
    const sCoordinate = page.getByRole('spinbutton',{name:'S coordinate in millimeters',exact:true});
    const movedS = Number(original[2]) + 3;
    await sCoordinate.fill(String(movedS)); await ready();
    const moved = await coordinates(page);
    assert(Number(moved[2]) === movedS && moved[0] === original[0] && moved[1] === original[1],
      'Moving the cutaway cursor changed the wrong source coordinate.');
    assert(await cutaway.getByRole('combobox',{name:'Surface cutaway plane',exact:true}).inputValue() === '2' &&
      same(cutVisible, await page.locator('.structure-row input[type=checkbox]').evaluateAll(items => items.map(item => item.checked))),
      'Moving the cutaway cursor lost its selected plane or changed structure visibility.');
    await sCoordinate.fill(String(original[2])); await ready();
    const removedSide = page.getByRole('combobox',{name:'Surface cutaway removed side',exact:true});
    const reversedSide = await removedSide.inputValue() === '1' ? '-1' : '1';
    await removedSide.selectOption(reversedSide); await ready();
    assert(await removedSide.inputValue() === reversedSide, 'The surface cutaway did not change its removed side.');
    assert(same(original,await coordinates(page)), 'Reversing the cutaway moved the cursor.');
    await cutButton.click(); await ready();
    assert(await cutButton.getAttribute('aria-pressed') === 'false', 'The surface cutaway toggle did not switch off.');
    assert(await cutaway.getByRole('combobox',{name:'Surface cutaway plane',exact:true}).count() === 0, 'Removing the cutaway left its controls active.');
    await page.getByRole('checkbox',{name:'Cursor',exact:true}).check();
    await page.getByRole('button',{name:'Reset view',exact:true}).click(); await ready();
    assert(await page.getByRole('checkbox',{name:'Cursor',exact:true}).isChecked(), 'Reset view did not restore the cursor.');
    assert(same(original,await coordinates(page)), 'Reset view changed the native entry coordinates.');
    checks.push('Cursor visibility, cursor-following cutaways and reset remain usable without scene or export controls');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert(same(original,await coordinates(page)), 'Ordinary page scrolling moved the native cursor.');
    await page.evaluate(() => window.scrollTo(0, 0));
    checks.push('Ordinary page scrolling preserves the native point without an expanded-view mode');
    await page.getByRole('checkbox',{name:'Compare sources',exact:true}).check();
    const comparisonPicker = page.getByRole('combobox',{name:'Compare with',exact:true});
    const comparisonKeys = await comparisonPicker.locator('option').evaluateAll(options => options.map(option => option.value));
    const offeredComparisons = comparisonKeys.map(key => catalog.packages.find(item => item.key === key));
    assert(comparisonKeys.includes(comparison.key), 'Compare with omitted the eligible SPL/NAC source.');
    assert(offeredComparisons.every(item => item && item.dataset_id !== primary.dataset_id && item.dataset_id !== 'cit168_native' && coverageFor(item).length),
      'Compare with offered the primary source or a source outside cerebral cortex.');
    await comparisonPicker.selectOption(comparison.key);
    const left=page.getByRole('region',{name:'Primary atlas workspace',exact:true}),right=page.getByRole('region',{name:'Comparison atlas workspace',exact:true});
    await right.locator('.structure-list button[title=' + JSON.stringify(comparisonIds[0]) + ']').waitFor({state:'attached'});
    await ready(right);
    assert(await right.locator('.workspace-heading h1').textContent() === 'Cerebral cortex', 'Comparison lost the current anatomical category.');
    assert(await right.locator('.anatomy-scope input').count() === 0 &&
      await right.getByRole('checkbox',{name:'Cerebral cortex only',exact:true}).count() === 0,
      'Comparison retained the removed category-filter toggle.');
    const comparisonManifestResponse = await page.request.get(origin + '/atlas/' + encodeURIComponent(comparison.key) + '/manifest.json');
    assert(comparisonManifestResponse.ok(), 'The exact comparison source manifest is unavailable.');
    const comparisonManifest = await comparisonManifestResponse.json();
    const comparisonLibraryOrder = [
      ...comparisonManifest.structures.filter(item => comparisonIds.includes(item.id)),
      ...comparisonManifest.structures.filter(item => !comparisonIds.includes(item.id)),
    ];
    await page.waitForFunction(({firstId,count}) => {
      const slot = document.querySelector('[aria-label="Comparison atlas workspace"]');
      return slot && slot.querySelector('.structure-list button[title]')?.getAttribute('title') === firstId &&
        slot.querySelectorAll('.structure-row').length === count;
    }, {firstId:comparisonLibraryOrder[0].id,count:comparisonManifest.structures.length});
    const comparedRows = await right.locator('.structure-row').evaluateAll(rows => rows.map(row => ({
      id:row.querySelector('button[title]')?.getAttribute('title'),checked:row.querySelector('input[type=checkbox]')?.checked,
      name:row.querySelector('button')?.getAttribute('aria-label'),group:row.querySelector('button small')?.textContent?.trim(),
      selected:row.classList.contains('selected'),
    })));
    const comparedIds = comparedRows.map(row => row.id), completeComparisonIds = comparisonLibraryOrder.map(item => item.id);
    assert(JSON.stringify(comparedIds) === JSON.stringify(completeComparisonIds), 'Comparison did not list its complete SPL/NAC source in group-first source order.');
    assert(comparedRows.every((row,index) => row.name === comparisonLibraryOrder[index].name &&
      row.group === (comparisonIds.includes(row.id) ? 'Cerebral cortex' : 'Background')), 'Comparison lost source names or group attributions.');
    const checkedComparisonIds = comparedRows.filter(row => row.checked).map(row => row.id);
    assert(checkedComparisonIds.length === comparisonIds.length && same(checkedComparisonIds,comparisonIds), 'Comparison reused primary structure IDs or displayed structures outside its SPL/NAC cortex scope.');
    const selectedComparisonRows = comparedRows.filter(row => row.selected);
    assert(selectedComparisonRows.length === 1 && selectedComparisonRows[0].id === comparisonLibraryOrder[0].id, 'Comparison did not select its first group row.');
    const comparisonDefaultPoint = (await coordinates(right)).map(Number);
    assert(JSON.stringify(comparisonDefaultPoint) === JSON.stringify(comparisonLibraryOrder[0].target_ras_mm.map(value => Number(value.toFixed(2)))),
      'Comparison default cursor does not retain its first group row source target.');
    assert(await right.getByRole('combobox',{name:'Anatomy category',exact:true}).inputValue() === 'group', 'Comparison did not default its batch target to the current group.');
    assert(await right.getByText(comparisonIds.length + ' of ' + comparisonManifest.structures.length + ' structures shown',{exact:true}).count() === 1,
      'Comparison did not retain its complete source count.');
    const comparisonNote = [...new Set(coverageFor(comparison).map(item => item.coverage_note).filter(Boolean))].join(' ');
    assert(comparisonNote, 'The comparison source lost its API coverage description.');
    const second = await coordinates(right);
    const originalZoom = await left.getByRole('slider',{name:'2D zoom',exact:true}).inputValue();
    await right.getByRole('combobox',{name:'View layout',exact:true}).selectOption('coronal'); await ready(right);
    const comparisonZoom = right.getByRole('slider',{name:'2D zoom',exact:true});
    await comparisonZoom.press('End'); await ready(right);
    assert(Number(await comparisonZoom.inputValue()) > 1, 'The comparison 2D zoom slider did not magnify its sections.');
    assert(await left.getByRole('slider',{name:'2D zoom',exact:true}).inputValue() === originalZoom, 'Comparison magnification changed the primary zoom.');
    assert(same(original,await coordinates(left)) && same(second,await coordinates(right)), 'Comparison linked independent native coordinates.');
    await comparisonZoom.press('Home'); await ready(right);
    assert(await comparisonZoom.inputValue() === '1', 'The comparison 2D zoom slider did not restore its complete field of view.');
    assert(await left.getByRole('slider',{name:'2D zoom',exact:true}).inputValue() === originalZoom &&
      same(original,await coordinates(left)) && same(second,await coordinates(right)), 'Restoring comparison zoom changed the primary view or native coordinates.');
    await page.screenshot({path:'output/playwright/release-comparison.png',fullPage:true});
    await page.getByRole('checkbox',{name:'Compare sources',exact:true}).uncheck(); await ready();
    assert(same(original,await coordinates(page)), 'Closing comparison lost the primary view.');
    checks.push('Same-category comparison excludes the primary and unrelated sources, uses each source scope and preserves independent native coordinates');
    await page.setViewportSize({width:820,height:1000});
    const library = left.getByRole('button',{name:'Structure library',exact:true});
    await library.click();
    assert(await library.getAttribute('aria-expanded') === 'true', 'The structure library toggle did not open its sidebar.');
    assert(await page.getByRole('searchbox',{name:'Search structures',exact:true}).isVisible(), 'Narrow structure drawer is inaccessible.');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Narrow layout overflows the page.');
    assert(await library.getAttribute('aria-expanded') === 'true', 'The structure library closed before its toggle was used.');
    await library.click();
    assert(await library.getAttribute('aria-expanded') === 'false', 'The structure library toggle did not close its sidebar.');
    await page.screenshot({path:'output/playwright/release-narrow.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    checks.push('Narrow layout keeps anatomy controls accessible');
    await page.goto(origin + '/?view=atlas&atlas=' + model.key); await ready();
    await page.locator('.model-display-details > summary').click();
    const modelCutaway = page.locator('.model-cutaway');
    const modelCutButton = modelCutaway.getByRole('button',{name:'Cutaway',exact:true});
    assert(await modelCutButton.getAttribute('aria-pressed') === 'false', 'The model cutaway toggle did not start off.');
    assert(await modelCutaway.getByRole('combobox',{name:'Model cutaway axis',exact:true}).count() === 0, 'An inactive model cutaway still shows its axis menu.');
    await modelCutButton.click(); await ready();
    assert(await modelCutButton.getAttribute('aria-pressed') === 'true', 'The model cutaway toggle did not activate.');
    assert(await modelCutaway.getByRole('combobox',{name:'Model cutaway axis',exact:true}).isVisible(), 'The active model cutaway lost its axis menu.');
    const modelPoint = await page.locator('.model-coordinate-bar').textContent();
    await modelCutaway.getByRole('button',{name:'Reverse cutaway',exact:true}).click(); await ready();
    assert(await page.locator('.model-coordinate-bar').textContent() === modelPoint, 'Model cutaway changed native coordinates.');
    await modelCutButton.click(); await ready();
    assert(await modelCutButton.getAttribute('aria-pressed') === 'false', 'The model cutaway toggle did not switch off.');
    assert(await modelCutaway.getByRole('combobox',{name:'Model cutaway axis',exact:true}).count() === 0, 'The model retained a removed cutaway.');
    const opacity = page.getByRole('slider',{name:'Model opacity',exact:true});
    assert(Number(await opacity.inputValue()) === .5, 'New native model views must start 3D opacity at fifty percent.');
    await opacity.press('Home'); await ready();
    assert(await opacity.inputValue() === '0', 'Overall model opacity did not update.');
    await opacity.press('End'); await ready();
    assert(await page.locator('.model-coordinate-bar').textContent() === modelPoint, 'Model opacity changed native coordinates.');
    await page.screenshot({path:'output/playwright/release-model-controls.png',fullPage:true});
    checks.push('Native model cutaways and overall opacity remain usable without the removed viewer footer');
    assert(!errors.length, errors.join('\n'));
    assert(!retiredRequests.length, 'The browser requested retired learning resources.');
    assert(!operations.length, 'Read-only browsing requested installation jobs: ' + operations.join('\n'));
    return {status:'passed',checks,page_errors:errors,retired_requests:retiredRequests,installation_requests:operations,comparison_api_coverage_note:comparisonNote};
  } finally {page.off('pageerror',onError);page.off('request',onRequest);}
}
