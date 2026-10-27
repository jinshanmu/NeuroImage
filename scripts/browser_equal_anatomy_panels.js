async page => {
  // Development-branch reference: requires the retained scene/import/export footer.
  // This historical workflow is not a formal-release acceptance script.
  const origin = new URL(page.url()).origin, errors = [], external = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError);
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Image export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout: 120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  const position = () => Promise.all(['R', 'A', 'S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const resize = async viewport => {
    await page.setViewportSize(viewport);
    await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, viewport);
    await ready();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.canvas-shell canvas'), box = canvas.getBoundingClientRect();
      return Math.abs(canvas.width - box.width * devicePixelRatio) <= 1 && Math.abs(canvas.height - box.height * devicePixelRatio) <= 1;
    });
  };
  const output = 'data/benchmarks/julich_selected/right-3d-layout-20261014';
  const comparePixels = async (before, after) => {
    const metrics = await page.evaluate(async images => {
      const decode = async encoded => {
        const image = await createImageBitmap(new Blob([Uint8Array.from(atob(encoded), letter => letter.charCodeAt(0))], {type: 'image/png'}));
        const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext('2d');
        context.drawImage(image, 0, 0); image.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [a, b] = await Promise.all(images.map(decode));
      if (a.width !== b.width || a.height !== b.height) throw Error('Restored canvas size changed.');
      let changed = 0, imageChanged = 0, maximum = 0;
      for (let offset = 0; offset < a.data.length; offset += 4) {
        let difference = 0;
        for (let channel = 0; channel < 4; channel++) difference = Math.max(difference, Math.abs(a.data[offset + channel] - b.data[offset + channel]));
        if (difference) { changed++; if ((offset / 4) % a.width < a.width * .75) imageChanged++; }
        maximum = Math.max(maximum, difference);
      }
      return {different_pixels: changed, image_plane_different_pixels: imageChanged, maximum_channel_difference: maximum, maximum_rounding_pixels: Math.ceil(a.width * a.height * .25 * .0001)};
    }, [before.toString('base64'), after.toString('base64')]);
    assert(metrics.image_plane_different_pixels === 0 && metrics.different_pixels <= metrics.maximum_rounding_pixels && metrics.maximum_channel_difference <= 1,
      'Scene restoration exceeded the documented 0.01-percent, one-channel-level 3D rounding tolerance: ' + JSON.stringify(metrics));
    return metrics;
  };
  await ready();
  const exit = page.getByRole('button', {name: 'Exit expanded view', exact: true});
  if (await exit.isVisible()) await exit.click();
  await resize({width: 1600, height: 1050});
  await page.getByLabel('Import scene file', {exact: true}).setInputFiles('data/exports/julich_selected/teaching/fbcf1a2e1a03705dc2ffe2b9f5172d06fa62e0b427b043f02ab3fca0226dc5e0/content.json');
  await ready();
  await page.getByLabel('View layout', {exact: true}).selectOption('anatomy');
  await ready();
  const initial = await position(), source = await page.getByLabel('Source', {exact: true}).inputValue();
  assert(source === 'julich_selected-53ec2653119db4ba' && JSON.stringify(initial) === '[-28,-29,-15]', 'Open the preserved left CA1 presentation before this source-specific pointer check.');
  await page.getByRole('button', {name: 'Save scene', exact: true}).click(); await ready();
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem('neuroimage:scene:' + key)), source);
  assert(JSON.stringify(saved.state.camera.slice(0, 2)) === '[110,15]' && saved.state.fitVisible3D === true, 'Automatic source fitting did not preserve the camera angles.');
  const fittedCamera = saved.state.camera, fittedFocus = saved.state.focus3D;
  const canvas = page.locator('.canvas-shell canvas');
  await page.mouse.move(10, 20); const baseline = await canvas.screenshot({path: output + '/baseline-canvas.png'});
  const sectionChecks = [];
  // These points were inspected in the actual 1600 by 1050 source display.
  for (const fixture of [{plane: 'axial', x: 190, y: 180, fixed: 2}, {plane: 'coronal', x: 580, y: 180, fixed: 1}, {plane: 'sagittal', x: 970, y: 200, fixed: 0}]) {
    await canvas.click({position: {x: fixture.x, y: fixture.y}}); await ready();
    const point = await position();
    assert(Math.abs(point[fixture.fixed] - initial[fixture.fixed]) < .001 && point.some((value, axis) => Math.abs(value - initial[axis]) > .1), fixture.plane + ' pointer lost its native fixed coordinate.');
    sectionChecks.push({plane: fixture.plane, point});
    await page.getByRole('button', {name: 'Restore saved', exact: true}).click(); await ready();
  }
  await canvas.dblclick({position: {x: 1280, y: 380}}); await ready();
  const surface = await position();
  assert(surface[0] < 0 && surface.some((value, axis) => Math.abs(value - initial[axis]) > .1), 'The right-hand 3D pointer did not update the native source point.');
  assert((await page.locator('.coordinate-status').innerText()).includes('Left CA1'), 'The inspected source surface selected another structure.');
  await page.getByRole('button', {name: 'Restore saved', exact: true}).click(); await ready(); await page.mouse.move(10, 20);
  const restored = await comparePixels(baseline, await canvas.screenshot({path: output + '/restored-canvas.png'}));
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 1360, box.y + 300); await page.mouse.down();
  await page.mouse.move(box.x + 1410, box.y + 320, {steps: 6}); await page.mouse.up(); await ready(); await page.mouse.move(10, 20);
  assert(await page.getByLabel('Fit visible 3D', {exact: true}).isChecked() && !baseline.equals(await canvas.screenshot()), 'Rotation did not retain complete source fitting.');
  assert(JSON.stringify(await position()) === JSON.stringify(initial), 'Rotating the source changed the shared image location.');
  await page.getByRole('button', {name: 'Restore saved', exact: true}).click(); await ready();
  await page.getByLabel('3D zoom', {exact: true}).fill('3'); await ready();
  assert(!await page.getByLabel('Fit visible 3D', {exact: true}).isChecked(), 'Manual zoom did not switch to fixed camera scale.');
  await page.getByRole('button', {name: 'Restore saved', exact: true}).click(); await ready(); await page.mouse.move(10, 20);
  const fittedRestore = await comparePixels(baseline, await canvas.screenshot());
  let event = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export scene', exact: true}).click(); await (await event).saveAs(output + '/scene.json');
  await page.getByLabel('View layout', {exact: true}).selectOption('quad'); await ready();
  await page.getByLabel('Import scene file', {exact: true}).setInputFiles(output + '/scene.json'); await ready(); await page.mouse.move(10, 20);
  const imported = await comparePixels(baseline, await canvas.screenshot());
  event = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export image', exact: true}).click(); await (await event).saveAs(output + '/teaching.zip');
  const captures = [];
  await page.getByRole('button', {name: 'Expand viewer', exact: true}).click();
  for (const viewport of [{width: 1100, height: 900}, {width: 900, height: 800}, {width: 900, height: 1400}]) {
    await resize(viewport);
    assert(JSON.stringify(await position()) === JSON.stringify(initial), 'Resizing changed the native source point.');
    const capture = output + '/' + viewport.width + 'x' + viewport.height + '.png';
    await page.screenshot({path: capture, fullPage: false});
    await page.getByRole('button', {name: 'Save scene', exact: true}).click(); await ready();
    const resized = await page.evaluate(key => JSON.parse(localStorage.getItem('neuroimage:scene:' + key)), source);
    assert(resized.state.fitVisible3D === true && resized.state.camera[2] > 0 && JSON.stringify(resized.state.focus3D) === JSON.stringify(fittedFocus), 'Resizing lost the complete source fitting state.');
    captures.push({viewport, canvas: await canvas.boundingBox(), capture, camera: resized.state.camera});
  }
  await resize({width: 1100, height: 900});
  const renderer = await canvas.evaluate(element => {
    const gl = element.getContext('webgl2'), extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : null;
  });
  page.off('pageerror', onError); await page.unroute('**/*');
  assert(!errors.length && !external.length, errors.concat(external).join('\n'));
  return {status: 'passed', source, initial, layout: 'anatomy', panel_order: 'Four equal panels in one row at every tested size; axial, coronal, sagittal and complete 3D from left to right', fitted_camera: fittedCamera, fitted_focus: fittedFocus, section_checks: sectionChecks, surface_pointer: surface,
    restored_pixels: restored, restored_fitting_pixels: fittedRestore, imported_pixels: imported, rotation_retains_fitting: true, manual_zoom_disables_fitting: true, captures, renderer, page_errors: errors, external_requests: external};
}
