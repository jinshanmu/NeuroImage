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
      const selector = model ? '.model-status' : '.live-status';
      return document.querySelector(selector)?.textContent?.startsWith('Ready') || !!document.querySelector('[role=alert]');
    }, model, {timeout: 120000});
    assert(await page.getByRole('alert').count() === 0, 'A viewer error is visible: ' + (await page.getByRole('alert').allTextContents()).join(' · '));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
        await page.getByRole('button', {name:'Structure library',exact:true}).click();
        await page.locator('.structure-row input[type=checkbox]').first().waitFor({state:'visible'});
        const toggles = page.locator('.structure-row input[type=checkbox]');
        assert(await toggles.count() === manifest.structures.length, source.key + ': missing structures');
        assert(await toggles.evaluateAll(items => items.every(item => item.checked)), source.key + ': initial visibility is incomplete');
        await toggles.first().uncheck(); await ready(model);
        await toggles.first().check(); await ready(model);
        if (model) await page.locator('.model-library .panel-title button').click();
        else await page.getByRole('button', {name:'Close structure library',exact:true}).click();
      }
      if (model) {
        await page.getByRole('button', {name:'Focus selected',exact:true}).click(); await ready(true);
        await page.getByRole('button', {name:'Full model view',exact:true}).click(); await ready(true);
      } else {
        const coordinates = await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value));
        for (const layout of ['axial', 'coronal', 'sagittal', '3d']) {
          await page.getByRole('combobox', {name:'View layout',exact:true}).selectOption(layout); await ready(false);
        }
        assert(JSON.stringify(coordinates) === JSON.stringify(await page.locator('.coordinate-bar input').evaluateAll(items => items.map(item => item.value))), source.key + ': layout moved the native point');
        await page.getByRole('combobox', {name:'View layout',exact:true}).selectOption('quad'); await ready(false);
        await page.getByRole('button', {name:'Magnify at cursor',exact:true}).click(); await ready(false);
        assert(Number(await page.getByRole('slider', {name:'2D zoom',exact:true}).inputValue()) >= 3, '2D magnification failed.');
        await page.getByRole('button', {name:'Full sections',exact:true}).click(); await ready(false);
        assert(await page.getByRole('slider', {name:'2D zoom',exact:true}).inputValue() === '1', 'Full sections failed.');
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
