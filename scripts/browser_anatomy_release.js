async page => {
  // Run with Playwright CLI against the local workspace in an isolated profile.
  // Optional ?check-from=0&check-count=8 selects a bounded portion of the catalog.
  const origin = new URL(page.url()).origin;
  const options = new URL(page.url()).searchParams;
  const offset = Number(options.get('check-from') ?? 0);
  const limit = Number(options.get('check-count') ?? 39);
  // Large native streamline/model sources can take longer on software WebGL.
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);
  const errors = [], retiredRequests = [], results = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const onError = error => errors.push(String(error));
  const onRequest = request => {
    if (/\/api\/workspace\/(?:teaching|courses|content)(?:\/|$)|\/lessons\.json(?:\?|$)/.test(request.url()))
      retiredRequests.push(request.url());
  };
  page.on('pageerror', onError); page.on('request', onRequest);
  const response = await page.request.get(origin + '/api/workspace/browse');
  assert(response.ok(), 'The local anatomy catalog is unavailable.');
  const catalog = await response.json();
  const newest = new Map();
  for (const item of catalog.packages.filter(item => item.status === 'available')
    .sort((a, b) => b.created_utc.localeCompare(a.created_utc)))
    if (!newest.has(item.dataset_id)) newest.set(item.dataset_id, item);
  const sources = [...newest.values()].sort((a, b) => a.dataset_id.localeCompare(b.dataset_id));
  const ready = async model => {
    await page.waitForFunction(model => {
      const selector = model ? '.model-canvas-shell' : '.canvas-shell';
      return document.querySelector(selector)?.dataset.ready === 'true' || !!document.querySelector('[role=alert],.load-error');
    }, model, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.locator('[role=alert],.load-error').count() === 0,
      'A viewer error is visible: ' + (await page.locator('[role=alert],.load-error').allTextContents()).join(' · '));
    assert(await page.locator((model ? '.model-canvas-shell' : '.canvas-shell') + '[data-ready="true"]').count() === 1,
      'The source canvas did not become ready.');
    assert(await page.getByRole('button', {name:/^(Full sections|Magnify at cursor)$/}).count() === 0,
      'The viewer retained a redundant 2D zoom action.');
  };
  try {
    for (const source of sources.slice(offset, offset + limit)) {
      const started = Date.now();
      await page.goto(origin + '/?view=atlas&atlas=' + encodeURIComponent(source.key));
      const model = source.representation === 'surface-model';
      await ready(model);
      const openMs = Date.now() - started;
      assert(await page.getByRole('button', {name:'Teaching library',exact:true}).count() === 0, 'Teaching library remains.');
      assert(await page.getByRole('button', {name:'Learning tools',exact:true}).count() === 0, 'Learning tools remain.');
      assert(await page.locator('.course-presentation,.model-tools,.inspector').count() === 0, 'A retired panel remains.');
      const canvas = page.locator('.atlas-slot canvas');
      const box = await canvas.boundingBox();
      assert(box && box.width > 500 && box.height > 300, source.key + ': empty canvas');
      const manifestResponse = await page.request.get(origin + '/atlas/' + source.key + '/manifest.json');
      const manifest = await manifestResponse.json();
      if (manifest.structures.length) {
        const library = page.getByRole('region', {name:'Primary atlas workspace',exact:true}).getByRole('button', {name:'Structure library',exact:true});
        await library.click();
        assert(await library.getAttribute('aria-expanded') === 'true', source.key + ': the structure library toggle did not open its sidebar');
        await page.locator('.structure-row input[type=checkbox]').first().waitFor({state:'visible'});
        const toggles = page.locator('.structure-row input[type=checkbox]');
        assert(await toggles.count() === manifest.structures.length, source.key + ': missing structures');
        assert(await toggles.evaluateAll(items => items.every(item => item.checked)), source.key + ': initial visibility is incomplete');
        await toggles.first().uncheck(); await ready(model);
        await toggles.first().check(); await ready(model);
        assert(await library.getAttribute('aria-expanded') === 'true', source.key + ': the structure library closed before its toggle was used');
        await library.click();
        assert(await library.getAttribute('aria-expanded') === 'false', source.key + ': the structure library toggle did not close its sidebar');
      }
      if (model) {
        await page.getByRole('button', {name:'Focus selected',exact:true}).click(); await ready(true);
        await page.getByRole('button', {name:'Full model view',exact:true}).click(); await ready(true);
      } else {
        const coordinates = await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value));
        for (const name of ['2D zoom', '3D zoom']) {
          const control = page.getByRole('slider', {name,exact:true});
          const range = await control.evaluate(input => [Number(input.min), Number(input.max), Number(input.step)]);
          assert(JSON.stringify(range) === '[1,10,0.1]', source.key + ': ' + name + ' range is not 1–10 with a 0.1 step');
          assert(Number(await control.inputValue()) === 1, source.key + ': ' + name + ' did not start at 1×');
        }
        for (const layout of ['axial', 'coronal', 'sagittal', '3d']) {
          await page.getByRole('combobox', {name:'View layout',exact:true}).selectOption(layout); await ready(false);
        }
        assert(JSON.stringify(coordinates) === JSON.stringify(await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value))), source.key + ': layout moved the native point');
        await page.getByRole('combobox', {name:'View layout',exact:true}).selectOption('quad'); await ready(false);
        const zoom = page.getByRole('slider', {name:'2D zoom',exact:true});
        await zoom.press('End'); await ready(false);
        assert(Number(await zoom.inputValue()) === 10, 'The 2D zoom slider did not reach 10×.');
        assert(JSON.stringify(coordinates) === JSON.stringify(await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value))), source.key + ': 2D zoom moved the native point');
        await zoom.press('Home'); await ready(false);
        assert(await zoom.inputValue() === '1', 'The 2D zoom slider did not restore the complete field of view.');
        assert(JSON.stringify(coordinates) === JSON.stringify(await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value))), source.key + ': restoring 1x moved the native point');
        const zoom3D = page.getByRole('slider', {name:'3D zoom',exact:true});
        await zoom3D.press('ArrowRight'); await ready(false);
        assert(Number(await zoom3D.inputValue()) === 1.1, 'The 3D zoom slider did not advance by 0.1.');
        assert(JSON.stringify(coordinates) === JSON.stringify(await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value))), source.key + ': 3D zoom moved the native point');
        await zoom3D.press('Home'); await ready(false);
        assert(Number(await zoom3D.inputValue()) === 1, 'The 3D zoom slider did not return to 1×.');
      }
      await canvas.screenshot({path:'output/playwright/atlas-' + source.dataset_id + '.png'});
      assert(await page.locator('[role=alert]').count() === 0, source.key + ': visible error');
      results.push({dataset:source.dataset_id,key:source.key,representation:source.representation,structures:manifest.structures.length,open_ms:openMs,status:'passed'});
    }
    assert(!errors.length, errors.join('\n'));
    assert(!retiredRequests.length, 'The viewer requested removed learning resources: ' + retiredRequests.join(', '));
    return {status:'passed',offset,source_configurations:sources.length,checked:results.length,results,page_errors:errors,retired_requests:retiredRequests};
  } catch (error) {
    return {status:'failed',error:String(error),url:page.url(),offset,source_configurations:sources.length,checked:results.length,results,page_errors:errors,retired_requests:retiredRequests};
  } finally {
    page.off('pageerror', onError); page.off('request', onRequest);
  }
}
