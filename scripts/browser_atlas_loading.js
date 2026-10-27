async page => {
  // Run through Playwright CLI in an isolated profile against a local workspace.
  const origin = new URL(page.url()).origin, checks = [], errors = [], requests = [];
  const assert = (value, message) => { if (!value) throw Error(message); };
  const catalog = await (await page.request.get(origin + '/api/workspace/browse')).json();
  const latest = id => catalog.packages.filter(item => item.dataset_id === id && item.status === 'available')
    .sort((a,b) => b.created_utc.localeCompare(a.created_utc))[0];
  const image = latest('cerebra'), model = latest('z_anatomy');
  assert(image && model, 'Serve CerebrA and Z-Anatomy for the loading check.');
  const onError = error => errors.push(String(error));
  const onRequest = request => requests.push({url:request.url(),method:request.method()});
  page.on('pageerror', onError); page.on('request', onRequest);
  page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  const ready = async () => {
    await page.waitForFunction(() => !!document.querySelector('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"]') ||
      !!document.querySelector('[role=alert],.load-error'), null, {timeout:120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(await page.locator('[role=alert],.load-error').count() === 0, 'The atlas reported an error.');
    assert(await page.locator('.canvas-shell[data-ready="true"],.model-canvas-shell[data-ready="true"]').count() === 1,
      'The atlas canvas did not become ready.');
    const control = await page.locator('.model-canvas-shell').count()
      ? page.getByRole('button',{name:'Full model view',exact:true})
      : page.getByRole('combobox',{name:'View layout',exact:true});
    assert(await control.isEnabled(), 'The atlas appeared before its viewing controls were usable.');
  };
  let release;
  try {
    for (const source of [image,model]) {
      let first = true, firstCatalog = true;
      const gate = new Promise(resolve => { release = resolve; });
      if (source === image) {
        // Force the ordinary home opening to use exact-package activation.
        await page.route(url => url.pathname === '/api/atlases', async route => {
          if (!firstCatalog) return route.continue();
          firstCatalog = false;
          const response = await route.fetch(), data = await response.json();
          await route.fulfill({json:{...data,atlases:[]}});
        });
      }
      await page.route(url => url.pathname.startsWith('/atlas/' + source.key + '/') && /\.(nii(?:\.gz)?|gii|ngm|nim)$/.test(url.pathname), async route => {
        if (first) { first = false; await gate; }
        await route.continue();
      });
      const assetRequest = page.waitForRequest(request => request.url().includes('/atlas/' + source.key + '/') && /\.(nii(?:\.gz)?|gii|ngm|nim)$/.test(new URL(request.url()).pathname));
      if (source === image) {
        await page.goto(origin + '/?view=anatomy');
        await page.getByRole('combobox',{name:'Source for Cerebral cortex',exact:true}).selectOption('cerebra');
        await page.getByRole('button',{name:'Browse Cerebral cortex',exact:true}).click();
      } else await page.goto(origin + '/?view=atlas&atlas=' + source.key);
      await assetRequest;
      await page.locator('.atlas-loading').waitFor();
      const loading = await page.evaluate(() => {
        const screen = document.querySelector('.atlas-loading'), style = getComputedStyle(screen), bounds = screen.getBoundingClientRect();
        const frame = screen.closest('.canvas-shell,.model-canvas-shell'), box = frame.getBoundingClientRect();
        return {text:screen.innerText.trim(),background:style.backgroundColor,frameBackground:getComputedStyle(frame).backgroundColor,opacity:style.opacity,ready:frame.dataset.ready,
          local:bounds.top > 0 && bounds.height < innerHeight && bounds.width === frame.clientWidth && bounds.height === frame.clientHeight &&
            bounds.left >= box.left && bounds.right <= box.right && bounds.top >= box.top && bounds.bottom <= box.bottom,
          header:getComputedStyle(document.querySelector('.app-header')).visibility === 'visible',
          canvases:Array.from(frame.querySelectorAll('canvas')).every(canvas => getComputedStyle(canvas).visibility === 'hidden')};
      });
      assert(loading.text === 'Loading', 'The canvas loading message contains extra text: ' + loading.text);
      assert(loading.ready === 'false', 'An unfinished atlas claimed to be ready.');
      assert(/^rgb\(/.test(loading.background) && loading.background === loading.frameBackground && loading.opacity === '1', 'The loading background does not match the opaque canvas background.');
      assert(loading.local && loading.header && loading.canvases, 'Loading escaped the atlas frame or exposed an unfinished canvas.');
      assert(await page.getByRole('link',{name:'NeuroImage home',exact:true}).isVisible(), 'Home navigation was hidden while loading.');
      await page.screenshot({path:'output/playwright/loading-' + source.dataset_id + '.png'});
      release(); release = undefined;
      await ready();
      if (source === image) {
        assert(requests.some(request => request.url.endsWith('/api/workspace/atlases/' + source.key)), 'Home opening bypassed the exact-package endpoint.');
        assert(!requests.some(request => request.method === 'POST' && request.url.endsWith('/api/workspace/jobs')), 'Home opening still starts and polls an activation job.');
        await page.getByRole('combobox',{name:'View layout',exact:true}).selectOption('3d'); await ready();
        await page.getByRole('combobox',{name:'View layout',exact:true}).selectOption('quad'); await ready();
        const manifest = await (await page.request.get(origin + '/atlas/' + source.key + '/manifest.json')).json();
        const contrast = page.getByRole('combobox',{name:'MRI contrast',exact:true});
        const originalId = await contrast.inputValue();
        const original = manifest.volumes.find(volume => volume.id === originalId);
        const alternate = manifest.volumes.find(volume => volume.kind === 'image' && volume.id !== originalId);
        assert(alternate, 'The image fixture needs two original MRI contrasts.');
        const canvas = page.locator('.canvas-shell canvas'), before = await canvas.screenshot();
        const browserAssets = await (await page.request.get(origin + '/atlas/' + source.key + '/_render.json')).json();
        const switchContrast = async volume => {
          const cached = browserAssets.assets[volume.file];
          const path = '/atlas/' + source.key + '/' + (cached ? '_render/' + cached.file : volume.file);
          const response = page.waitForResponse(response => new URL(response.url()).pathname === path);
          await contrast.selectOption(volume.id); await response; await ready();
        };
        await switchContrast(alternate);
        assert(!before.equals(await canvas.screenshot()), 'Changing MRI contrast reused stale background pixels.');
        await switchContrast(original);
        assert(before.equals(await canvas.screenshot()), 'Restoring the MRI contrast changed the original rendered pixels.');
        checks.push('MRI contrast changes its pixels and restores the original canvas exactly');
      } else {
        await page.getByRole('button',{name:'Focus selected',exact:true}).click(); await ready();
        await page.getByRole('button',{name:'Full model view',exact:true}).click(); await ready();
      }
      checks.push(source.dataset_id + ': Loading stays inside the opaque atlas frame until the atlas is usable');
      await page.unrouteAll({behavior:'wait'});
    }
    await page.route(url => url.pathname.startsWith('/atlas/' + model.key + '/') && /\.(gii|ngm)$/.test(url.pathname),
      route => route.fulfill({status:503,body:'Simulated unreadable asset'}));
    await page.goto(origin + '/?view=atlas&atlas=' + model.key);
    await page.getByRole('button',{name:'Reload viewer',exact:true}).waitFor();
    assert(!await page.locator('.atlas-loading').isVisible(), 'A failed atlas stayed behind a permanent loading screen.');
    assert(await page.getByRole('alert').count() > 0, 'A source error was hidden.');
    assert(await page.locator('.model-canvas-shell').getAttribute('data-ready') === 'false',
      'A failed source was marked as ready.');
    checks.push('An unreadable source leaves the loading screen and exposes recovery');
    assert(!errors.length, errors.join('\n'));
    return {status:'passed',checks,page_errors:errors};
  } catch (error) {
    return {status:'failed',error:String(error),url:page.url(),checks,page_errors:errors};
  } finally {
    release?.();
    await page.unrouteAll({behavior:'wait'});
    page.off('pageerror', onError); page.off('request', onRequest);
  }
}
