async page => {
  const errors = [], external = [], origin = new URL(page.url()).origin;
  const assert = (value, message) => { if (!value) throw new Error(message); };
  page.on('pageerror', error => errors.push(String(error)));
  await page.unroute('**/*');
  await page.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); external.push(route.request().url()); return route.abort(); });
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:60000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await page.setViewportSize({width:1720,height:1200}); await page.reload(); await ready();
  const {atlas,manifest} = await page.evaluate(async () => {
    const atlas = (await (await fetch('/api/atlases')).json()).atlases.find(item => item.dataset_id === 'ixi_mra');
    if (!atlas) throw new Error('Serve the native IXI002 MRA package.');
    return {atlas,manifest:await (await fetch(atlas.manifest_url)).json()};
  });
  assert(manifest.representation === 'mri-volume' && manifest.structures.length === 0 && manifest.volumes.length === 1, 'The native image acquired invented structures.');
  assert(await page.getByRole('button',{name:'Isolate selected',exact:true}).count() === 0, 'Image-only browsing exposes fabricated structure controls.');
  const volume = manifest.volumes[0], probes = [], canvas = page.locator('canvas');
  const coordinates = () => Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const sample = async (voxel, title) => {
    const ras = volume.affine_ras_mm.slice(0,3).map(row => row[3] + voxel.reduce((sum, value, axis) => sum + row[axis] * value, 0));
    for (let axis=0;axis<3;axis++) await page.getByLabel(['R','A','S'][axis] + ' coordinate in millimeters').fill(String(ras[axis]));
    await ready();
    const readout = await page.getByLabel('Source image intensity at cursor').textContent();
    assert(readout !== 'Unavailable at cursor', 'A declared interior source sample is unavailable.');
    const probe = {title,source_voxel:voxel,requested_ras_mm:ras,displayed_ras_mm:await coordinates(),value:Number(readout)}; probes.push(probe); return probe;
  };
  for (const voxel of [[120,180,20],[392,180,20],[190,300,70],[320,240,30],[256,256,40],[200,350,85],[300,150,8],[0,0,0],[511,511,99]]) await sample(voxel,'native source voxel');
  await page.getByLabel('R coordinate in millimeters').fill('900'); await ready();
  assert(await page.getByLabel('Source image intensity at cursor').textContent() === 'Unavailable at cursor', 'Outside coverage was shown as zero intensity.');
  const anchor = await sample([256,256,40],'display and recovery anchor');
  await page.getByLabel('Image window maximum',{exact:true}).fill('150'); await page.getByLabel('Image window minimum',{exact:true}).fill('0'); await ready();
  await canvas.screenshot({path:'output/playwright/native-mra-context.png'});
  await page.getByLabel('Image window maximum',{exact:true}).fill('250'); await page.getByLabel('Image window minimum',{exact:true}).fill('65'); await ready();
  assert(Number(await page.getByLabel('Source image intensity at cursor').textContent()) === anchor.value, 'Contrast changed an original source sample.');
  await canvas.screenshot({path:'output/playwright/native-mra-signal.png'});
  await page.getByLabel('3D intensity display',{exact:true}).uncheck(); await ready();
  await canvas.screenshot({path:'output/playwright/native-mra-no-volume.png'});
  await page.getByLabel('3D intensity display',{exact:true}).check(); await ready();
  await page.getByLabel('Radiological',{exact:true}).uncheck(); await ready();
  assert(Number(await page.getByLabel('Source image intensity at cursor').textContent()) === anchor.value, 'Display convention changed source sampling.');
  await canvas.screenshot({path:'output/playwright/native-mra-neurological.png'});
  await page.getByLabel('Radiological',{exact:true}).check();
  await page.getByLabel('Image window minimum',{exact:true}).fill('0'); await page.getByLabel('Image window maximum',{exact:true}).fill('150'); await ready();
  await page.getByLabel('New location annotation',{exact:true}).fill('Native source observation; anatomical interpretation awaits instructor review.');
  await page.getByRole('button',{name:'Add marker at cursor',exact:true}).click(); await ready();
  const key = 'neuroimage:scene:' + atlas.key, previous = await page.evaluate(key=>localStorage.getItem(key),key);
  const output = 'data/exports/ixi_mra/browser-validation';
  try {
    await page.getByRole('button',{name:'Save scene',exact:true}).click(); await ready();
    const scene = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
    assert(scene.state.selected === null && scene.state.visible.length === 0 && scene.state.annotations[0].structure_id === null, 'A source observation became an invented anatomical structure.');
    await canvas.screenshot({path:'output/playwright/native-mra-saved.png'});
    await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click(); await ready();
    assert((await coordinates()).every((value,axis)=>value===anchor.displayed_ras_mm[axis]), 'Magnification changed the physical source point.');
    await canvas.screenshot({path:'output/playwright/native-mra-magnified.png'});
    await page.getByRole('button',{name:'Restore saved',exact:true}).click(); await ready();
    await canvas.screenshot({path:'output/playwright/native-mra-restored.png'});
    const download = page.waitForEvent('download'); await page.getByRole('button',{name:'Export scene',exact:true}).click(); await(await download).saveAs(output+'/scene.json');
    await page.getByRole('button',{name:'Reset view',exact:true}).click(); await ready();
    await page.getByLabel('Import scene file').setInputFiles(output+'/scene.json'); await ready();
    await canvas.screenshot({path:'output/playwright/native-mra-imported.png'});
    const teaching = page.waitForEvent('download'); await page.getByRole('button',{name:'Export teaching image',exact:true}).click(); await(await teaching).saveAs(output+'/teaching-image.zip');
    const graphics = await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),extension=gl.getExtension('WEBGL_debug_renderer_info'); return {error:gl.getError(),renderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):'unavailable'};});
    assert(!errors.length && !external.length && graphics.error===0,'The native image workflow reported browser or graphics errors.');
    return {status:'passed',package_version:manifest.package_version,probes,scene,graphics,page_errors:errors,external_requests:external,
      export:output.replace(/^data\//,'')+'/teaching-image.zip',checks:['empty anatomical catalog','native oblique image samples','out-of-coverage unavailable','contrast-independent values','3D intensity visibility','left/right display convention','same-point magnification','exact scene and annotation recovery','credited export']};
  } finally { await page.evaluate(({key,previous})=>previous===null?localStorage.removeItem(key):localStorage.setItem(key,previous),{key,previous}); }
}
