async page => {
  // Use ?topics-from=0&topics-count=10 for a bounded rendering batch.
  // ?catalog-only=1 checks every discovered topic/source without loading viewers.
  // Verify actual source-library visibility and selection without scene exports.
  const initial = new URL(page.url()), origin = initial.origin;
  const offset = Number(initial.searchParams.get('topics-from') ?? 0);
  const limit = Number(initial.searchParams.get('topics-count') ?? 10);
  const catalogOnly = initial.searchParams.get('catalog-only') === '1';
  const assert = (value, message) => { if (!value) throw Error(message); };
  const sorted = values => [...new Set(values)].sort();
  const same = (left, right) => JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
  const text = value => (value ?? '').trim();
  const excludedIdentity = value => typeof value === 'string' &&
    /^(?:nextbrain|(?:ixi|hba|humanbrainatlas|mesoveins|venat|mouches|arterial_occurrence)(?:$|[_-]))/i.test(value);
  const isExcluded = item => [item.id, item.dataset_id, item.package_id, item.key,
    ...(item.sources ?? []).map(source => source.id)].some(excludedIdentity);
  const errors = [], results = [], discovery = [];
  const onError = error => errors.push(String(error));
  let phase = 'catalog', topics = [], parentOnScreen = null;
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', onError);

  const homeReady = async () => {
    await page.locator('.anatomy-home').waitFor();
    await page.locator('.anatomy-grid button.anatomy-entry').first().waitFor();
    await page.waitForFunction(() => {
      const controls = [...document.querySelectorAll('.anatomy-grid select,.anatomy-grid button.anatomy-entry')];
      return controls.length > 0 && controls.every(control => !control.disabled);
    });
    assert(await page.getByRole('alert').count() === 0,
      'Detailed anatomy discovery failed: ' + (await page.getByRole('alert').allTextContents()).join(' · '));
    assert(await page.locator('.anatomy-card .anatomy-entry p,.anatomy-card .source-coverage-note').count() === 0,
      'A detailed anatomy card still renders a long description or coverage note.');
    assert(await page.locator('.dataset-sidebar').getByRole('button', {name:'NextBrain',exact:true}).count() === 0,
      'Detailed discovery still offers the excluded NextBrain family.');
  };
  const viewerReady = async () => {
    await page.waitForFunction(() => !!document.querySelector('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"],[role=alert],.load-error'));
    assert(await page.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"]').count() === 1, 'The detailed source did not become ready.');
    assert(await page.locator('.load-error').count() === 0, 'The detailed source failed to load.');
    assert(await page.locator('.dataset-details-link,.scene-toolbar,.interaction-hint,.live-status').count() === 0, 'The detailed viewer retained a removed footer.');
    assert(await page.locator('.source-coverage-note').count() === 0, 'The detailed viewer retained a source coverage paragraph below its heading.');
    assert(await page.getByRole('alert').count() === 0,
      'The detailed source failed to open: ' + (await page.getByRole('alert').allTextContents()).join(' · '));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };

  try {
    assert(Number.isInteger(offset) && offset >= 0, 'topics-from must be a nonnegative integer.');
    assert(Number.isInteger(limit) && limit > 0, 'topics-count must be a positive integer.');
    const [activeResponse, browseResponse] = await Promise.all([
      page.request.get(origin + '/api/atlases'),
      page.request.get(origin + '/api/workspace/browse'),
    ]);
    assert(activeResponse.ok() && browseResponse.ok(), 'The local source catalogs are unavailable.');
    const atlases = (await activeResponse.json()).atlases;
    const catalog = await browseResponse.json();
    assert(Array.isArray(atlases) && Array.isArray(catalog.packages), 'Unexpected local source catalog format.');
    assert(![...atlases, ...catalog.packages, ...catalog.sources].some(isExcluded),
      'Detailed discovery still receives an excluded source or package.');

    // Match browseTargets: available stored packages, with active entries taking
    // precedence for the same key. Keep historical versions for scope checks.
    const byKey = new Map();
    for (const item of catalog.packages) {
      if (item.status === 'available' && typeof item.key === 'string') byKey.set(item.key, {...item, active:false});
    }
    for (const item of atlases) byKey.set(item.key, {...item, active:true});
    const targets = [...byKey.values()], topicMap = new Map();
    for (const target of targets) {
      for (const coverage of target.detail_coverage ?? []) {
        assert(coverage.id && coverage.title && coverage.parent_id,
          target.key + ': detailed coverage is missing its topic identity.');
        const previous = topicMap.get(coverage.id);
        assert(!previous || (previous.title === coverage.title && previous.parent_id === coverage.parent_id),
          coverage.id + ': source packages disagree on the current topic identity.');
        topicMap.set(coverage.id, {id:coverage.id,title:coverage.title,parent_id:coverage.parent_id,kind:coverage.kind});
      }
    }
    // Discover only topics backed by an available supported package. Retired
    // source-only topics and topics absent from a partial installation stay hidden.
    topics = [...topicMap.values()].sort((left, right) =>
      left.parent_id.localeCompare(right.parent_id) || left.id.localeCompare(right.id));
    assert(topics.length > 0, 'No detailed anatomy topics are available.');
    assert(catalogOnly || offset < topics.length, 'topics-from is outside the discovered topic range.');

    // Match groupTargets: newest package that actually supplies this topic,
    // preferring the active package when construction times are identical.
    const choicesFor = topic => {
      const latest = new Map();
      for (const target of targets) {
        if (!target.detail_coverage?.some(coverage => coverage.id === topic.id)) continue;
        const previous = latest.get(target.dataset_id);
        if (!previous || (target.created_utc ?? '') > (previous.created_utc ?? '') ||
          (target.created_utc === previous.created_utc && target.active && !previous.active)) {
          latest.set(target.dataset_id, target);
        }
      }
      return [...latest.values()];
    };
    const coverageFor = (topic, target) => target.detail_coverage.filter(item => item.id === topic.id);
    const noteFor = (topic, target) => [...new Set(coverageFor(topic, target)
      .map(item => text(item.coverage_note)).filter(Boolean))].join(' ');
    const preference = ['z_anatomy','cerebra','spl_nac','mida'];
    const sourceRank = target => {
      const rank = preference.indexOf(target.dataset_id);
      if (rank >= 0) return rank;
      // Repeated streamline loading is substantially heavier than small MRI
      // label or surface sources. Use it only when the topic requires it.
      return target.representation === 'mri-streamlines' ? 100 : 10;
    };
    const selectedTopics = catalogOnly ? topics : topics.slice(offset, offset + limit);
    for (const topic of selectedTopics) {
      phase = topic.id + ':discovery';
      if (parentOnScreen !== topic.parent_id) {
        await page.goto(origin + '/?view=anatomy&group=' + encodeURIComponent(topic.parent_id));
        await homeReady();
        parentOnScreen = topic.parent_id;
        assert(await page.locator('.anatomy-home-heading .eyebrow').textContent() === 'DETAILED ANATOMY',
          topic.parent_id + ': the parent route did not open Detailed anatomy.');
        const offeredTitles = await page.locator('.anatomy-grid .anatomy-entry h2')
          .evaluateAll(elements => elements.map(element => element.textContent.trim()));
        const expectedTitles = topics.filter(item => item.parent_id === topic.parent_id).map(item => item.title);
        assert(same(offeredTitles, expectedTitles) && offeredTitles.length === expectedTitles.length,
          topic.parent_id + ': UI topics differ from actual source coverage: ' + offeredTitles.join(', '));
        if (!discovery.some(item => item.parent_id === topic.parent_id)) {
          discovery.push({parent_id:topic.parent_id,topics:offeredTitles,status:'passed'});
        }
      }
      const choices = choicesFor(topic);
      assert(choices.length > 0, topic.id + ': no available source supplies the topic.');
      const source = page.getByRole('combobox', {name:'Source for ' + topic.title,exact:true});
      await source.waitFor();
      const offered = await source.locator('option').evaluateAll(options => options.map(option => option.value));
      const expectedSources = choices.map(item => item.dataset_id);
      assert(same(offered, expectedSources) && offered.length === expectedSources.length,
        topic.id + ': source selector differs from available scoped packages: ' + offered.join(', '));
      const notices = [];
      for (const dataset of offered) {
        const target = choices.find(item => item.dataset_id === dataset);
        const expectedNote = noteFor(topic, target);
        assert(expectedNote, topic.id + ': API coverage note is empty for ' + dataset + '.');
        await source.selectOption(dataset);
        assert(await page.getByLabel('Source coverage for ' + topic.title, {exact:true}).count() === 0,
          topic.id + ': selecting ' + dataset + ' restored a card coverage paragraph.');
        notices.push({dataset,key:target.key,coverage_note:expectedNote});
      }
      const result = {topic:topic.id,title:topic.title,parent_id:topic.parent_id,
        sources:offered,coverage_notices:notices,status:'passed'};
      if (!catalogOnly) {
        phase = topic.id + ':render';
        const selected = [...choices].sort((left, right) => sourceRank(left) - sourceRank(right) ||
          left.dataset_id.localeCompare(right.dataset_id))[0];
        await source.selectOption(selected.dataset_id);
        const started = Date.now();
        await page.getByRole('button', {name:'Browse ' + topic.title,exact:true}).click();
        await viewerReady();
        parentOnScreen = null;
        const route = new URL(page.url()).searchParams;
        assert(route.get('group') === topic.id && route.get('atlas') === selected.key,
          topic.id + ': opening the source lost its topic or package route.');
        assert(await page.locator('.workspace-heading h1,.workspace-heading .eyebrow')
          .evaluateAll((elements, title) => elements.some(element => element.textContent?.trim() === title), topic.title),
          topic.id + ': the model/MRI workspace lost its topic heading.');
        const expectedVisible = sorted(coverageFor(topic, selected).flatMap(item => item.structure_ids ?? []));
        let expectedSelected = [];
        let actualVisible = [], actualSelected = null;
        if (expectedVisible.length) {
          const libraryToggle = page.getByRole('button', {name:'Structure library',exact:true});
          if (await libraryToggle.count() && await libraryToggle.getAttribute('aria-expanded') === 'false') await libraryToggle.click();
          assert(await page.getByRole('checkbox', {name:topic.title + ' only',exact:true}).count() === 0,
            topic.id + ': the library retained its removed scope toggle.');
          const manifestResponse = await page.request.get(origin + '/atlas/' + encodeURIComponent(selected.key) + '/manifest.json');
          assert(manifestResponse.ok(), topic.id + ': the exact rendered source manifest is unavailable.');
          const manifest = await manifestResponse.json();
          const scopedStructures = manifest.structures.filter(structure => expectedVisible.includes(structure.id));
          assert(scopedStructures.length === expectedVisible.length && same(scopedStructures.map(item => item.id),expectedVisible),
            topic.id + ': topic coverage contains unavailable or duplicate source structures.');
          const libraryOrder = [...scopedStructures, ...manifest.structures.filter(structure => !expectedVisible.includes(structure.id))];
          expectedSelected = [libraryOrder[0].id];
          const section = page.getByRole('combobox', {name:selected.representation === 'surface-model' ? 'Model object category' : 'Anatomy category',exact:true});
          assert(await section.inputValue() === 'group', topic.id + ': the batch target did not default to the current group.');
          await page.waitForFunction(count => document.querySelectorAll('.structure-list .structure-row').length === count, manifest.structures.length);
          const rows = await page.locator('.structure-list .structure-row').evaluateAll(items => items.map(row => {
            const input = row.querySelector('input[type=checkbox]');
            return {id:row.querySelector('button[title]')?.getAttribute('title'),label:input?.getAttribute('aria-label'),
              name:row.querySelector('button')?.getAttribute('aria-label'),group:row.querySelector('button small')?.textContent?.trim(),
              visible:input?.checked,selected:row.classList.contains('selected')};
          }));
          assert(rows.length === manifest.structures.length, topic.id + ': the source library is missing full-source rows.');
          const mapped = rows.map((row,index) => {
            const structure = libraryOrder[index];
            // Group members precede background anatomy; each partition keeps
            // its exact source-manifest order and stable source identity.
            assert(row.label === 'Show ' + structure.name && (!row.id || row.id === structure.id),
              topic.id + ': the source-library row does not match the exact source manifest.');
            assert(row.name === structure.name && row.group === (expectedVisible.includes(structure.id) ? topic.title : 'Background'),
              topic.id + ': the source-library name or group attribution is incorrect.');
            return {...row,id:structure.id};
          });
          assert(JSON.stringify(mapped.map(item => item.id)) === JSON.stringify(libraryOrder.map(item => item.id)), topic.id + ': the library lost its group-first source order.');
          actualVisible = sorted(mapped.filter(item => item.visible).map(item => item.id));
          const selectedRows = mapped.filter(item => item.selected);
          assert(selectedRows.length === 1, topic.id + ': the source library has no unique selected structure.');
          actualSelected = selectedRows[0].id;
          assert(same(actualVisible,expectedVisible), topic.id + ': displayed source structures differ from topic coverage.');
          assert(actualSelected === libraryOrder[0].id, topic.id + ': the initial selection is not the first group row.');
          if (selected.representation === 'surface-model') {
            const expectedPoint = libraryOrder[0].target_native_mm.map(value => value.toFixed(2)).join(' · ');
            assert(await page.locator('.model-coordinate-bar > span').first().textContent() === 'Source XYZ (mm): ' + expectedPoint,
              topic.id + ': the default cursor does not retain the first row native XYZ target.');
          } else {
            const actualPoint = await page.locator('.coordinate-bar input').evaluateAll(inputs => inputs.map(input => Number(input.value)));
            const expectedPoint = libraryOrder[0].target_ras_mm.map(value => Number(value.toFixed(2)));
            assert(JSON.stringify(actualPoint) === JSON.stringify(expectedPoint), topic.id + ': the default cursor does not retain the first row source RAS target.');
          }
          assert(await page.getByText(expectedVisible.length + ' of ' + manifest.structures.length + ' structures shown', {exact:true}).count() === 1,
            topic.id + ': the library count does not use the complete source total.');
        } else {
          assert(await page.locator('.structure-list .structure-row input:checked').count() === 0,
            topic.id + ': an image-only topic displayed a structure.');
        }
        Object.assign(result, {selected_source:selected.dataset_id,selected_key:selected.key,
          representation:selected.representation,expected_visible:expectedVisible,actual_visible:actualVisible,
          expected_selected_ids:expectedSelected,actual_selected:actualSelected,image_only:expectedVisible.length === 0,
          allow_empty_selected:expectedVisible.length === 0,visible_verified:true,verification:'source-library-checkboxes',
          open_ms:Date.now() - started,api_atlas_coverage_note:noteFor(topic, selected)});
      }
      results.push(result);
      assert(!errors.length, errors.join('\n'));
    }
    return {status:'passed',catalog_only:catalogOnly,offset:catalogOnly ? 0 : offset,
      total_topics:topics.length,checked:results.length,discovery,results,page_errors:errors};
  } catch (error) {
    return {status:'failed',error:String(error),phase,url:page.url(),catalog_only:catalogOnly,
      offset,total_topics:topics.length,checked:results.length,discovery,results,page_errors:errors};
  } finally {
    page.off('pageerror', onError);
  }
}
