async page => {
  const origin=new URL(page.url()).origin, errors=[], external=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.unroute('**/*');await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  const ready=async()=>{await page.waitForFunction(()=>/^(Ready|Scene saved|Saved scene restored|Scene file restored|Image export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:120000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))};
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('[aria-label="Browse Arteries and veins"]')?.disabled);
  await page.getByRole('combobox',{name:'Source for Arteries and veins',exact:true}).selectOption('mesoveins');
  await page.getByRole('button',{name:'Browse Arteries and veins',exact:true}).click();await ready();
  const key=await page.getByRole('combobox',{name:'Source',exact:true}).inputValue();
  const {atlas,manifest}=await page.evaluate(async key=>{const atlas=(await(await fetch('/api/atlases')).json()).atlases.find(a=>a.key===key);return {atlas,manifest:await(await fetch(atlas.manifest_url)).json()}},key);
  assert(manifest.schema_version==='1.9'&&manifest.volumes[0].native_frame.frame===2&&!manifest.structures.length,'Native frame identity or structure inventory changed.');
  await page.getByRole('button',{name:'Structure library',exact:true}).click();
  assert(await page.getByText('Exact native frame 3 of 3.',{exact:false}).count()===1,'Selected original frame is not identified.');
  assert(await page.getByRole('link',{name:'Download original complete source series',exact:true}).getAttribute('href')===atlas.base_url+manifest.volumes[0].native_frame.source_file,'Original sequence link does not retain its source identity.');
  const probes=[],volume=manifest.volumes[0];
  for(const voxel of [[100,200,80],[472,200,80],[286,286,185],[250,400,220],[0,0,0],[571,571,369]]){
    const ras=volume.affine_ras_mm.slice(0,3).map(row=>row[3]+voxel.reduce((sum,value,axis)=>sum+row[axis]*value,0));
    for(let axis=0;axis<3;axis++)await page.getByLabel(['R','A','S'][axis]+' coordinate in millimeters').fill(String(ras[axis]));
    await ready();const value=await page.getByLabel('Source image intensity at cursor',{exact:true}).textContent();
    assert(value!=='Unavailable at cursor','Source voxel is unavailable.');probes.push({voxel,ras,value:Number(value)});
  }
  const center=probes[2];for(let axis=0;axis<3;axis++)await page.getByLabel(['R','A','S'][axis]+' coordinate in millimeters').fill(String(center.ras[axis]));await ready();
  await page.getByLabel('Image window maximum',{exact:true}).fill(String(volume.cal_max*.8));await ready();
  assert(Number(await page.getByLabel('Source image intensity at cursor',{exact:true}).textContent())===center.value,'Contrast changed the original sample.');
  await page.getByRole('button',{name:'Close structure library',exact:true}).click();
  const canvas=page.locator('.atlas-slot canvas');await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  await canvas.screenshot({path:'output/playwright/native-frame-saved.png'});
  await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();
  await page.screenshot({path:'output/playwright/mesoveins-same-point-magnified.png'});
  await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
  await canvas.screenshot({path:'output/playwright/native-frame-restored.png'});
  let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs('output/playwright/mesoveins-scene.json');
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();
  await page.getByLabel('Import scene file',{exact:true}).setInputFiles('output/playwright/mesoveins-scene.json');await ready();
  await canvas.screenshot({path:'output/playwright/native-frame-imported.png'});
  download=page.waitForEvent('download');await page.getByRole('button',{name:'Export image',exact:true}).click();await(await download).saveAs('data/benchmarks/mesoveins/browser-teaching-fixture.zip');
  await page.screenshot({path:'output/playwright/mesoveins-native-frame.png'});
  const graphics=await canvas.evaluate(canvas=>{const gl=canvas.getContext('webgl2');return {error:gl.getError(),maximum_3d_texture:gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)}});
  assert(!errors.length&&!external.length&&graphics.error===0,errors.concat(external).join('\n'));
  page.off('pageerror',onError);await page.unroute('**/*');
  return {status:'passed',package_version:manifest.package_version,probes,graphics,page_errors:errors,external_requests:external,checks:['exact native echo identity','original series access','oblique native voxel values','contrast-independent samples','full sections and magnification','scene restore and import','attributable teaching export']};
}
