async page => {
  // Development-branch reference: requires the retained scene/import/export footer.
  // This historical workflow is not a formal-release acceptance script.
  // Historical verification retained for provenance. HumanBrainAtlas is excluded
  // from the current application; this entry point does not open or activate it.
  const archivedVerification = async () => {
  const origin=new URL(page.url()).origin, errors=[], external=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.unroute('**/*');await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  const ready=async()=>{await page.waitForFunction(()=>/^(Ready|Scene saved|Saved scene restored|Scene file restored|Image export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:120000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))};
  const catalog=await(await page.request.get(origin+'/api/atlases')).json();
  const source=catalog.atlases.find(item=>item.dataset_id==='hba_native');
  assert(source,'Serve the native HBA image source.');
  assert(!source.coverage.some(item=>item.id==='general-anatomy'),'An image without labels was classified as a whole-brain atlas.');
  const started=Date.now();await page.goto(origin+'/?view=atlas&atlas='+encodeURIComponent(source.key));await ready();
  const loadedAt=Date.now();const key=await page.getByRole('combobox',{name:'Source',exact:true}).inputValue();
  const {atlas,manifest}=await page.evaluate(async key=>{const atlas=(await(await fetch('/api/atlases')).json()).atlases.find(a=>a.key===key);return {atlas,manifest:await(await fetch(atlas.manifest_url)).json()}},key);
  assert(manifest.volumes[0].shape.join(',')==='625,725,555'&&!manifest.structures.length,'Original HBA image grid or structure inventory changed.');
  const library=page.getByRole('region',{name:'Primary atlas workspace',exact:true}).getByRole('button',{name:'Structure library',exact:true});
  await library.click();
  assert(await library.getAttribute('aria-expanded')==='true','The structure library toggle did not open its sidebar.');
  const probes=[],volume=manifest.volumes[0];
  for(const voxel of [[180,400,300],[445,400,300],[312,362,277],[290,490,220],[0,0,0],[624,724,554]]){
    const ras=volume.affine_ras_mm.slice(0,3).map(row=>row[3]+voxel.reduce((sum,value,axis)=>sum+row[axis]*value,0));
    for(let axis=0;axis<3;axis++)await page.getByLabel(['R','A','S'][axis]+' coordinate in millimeters').fill(String(ras[axis]));
    await ready();const value=await page.getByLabel('Source image intensity at cursor',{exact:true}).textContent();
    assert(value!=='Unavailable at cursor','Source voxel is unavailable.');probes.push({voxel,ras,value:Number(value)});
  }
  const center=probes[2];for(let axis=0;axis<3;axis++)await page.getByLabel(['R','A','S'][axis]+' coordinate in millimeters').fill(String(center.ras[axis]));await ready();
  await page.getByLabel('Image window maximum',{exact:true}).fill(String(volume.cal_max*.8));await ready();
  assert(Number(await page.getByLabel('Source image intensity at cursor',{exact:true}).textContent())===center.value,'Contrast changed the original sample.');
  assert(await library.getAttribute('aria-expanded')==='true','The structure library closed before its toggle was used.');
  await library.click();
  assert(await library.getAttribute('aria-expanded')==='false','The structure library toggle did not close its sidebar.');
  const canvas=page.locator('.atlas-slot canvas');await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  await canvas.screenshot({path:'output/playwright/hba-image-saved.png'});
  await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();
  await page.screenshot({path:'output/playwright/hba_native-same-point-magnified.png'});
  await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
  await canvas.screenshot({path:'output/playwright/hba-image-restored.png'});
  let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs('output/playwright/hba_native-scene.json');
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();
  await page.getByLabel('Import scene file',{exact:true}).setInputFiles('output/playwright/hba_native-scene.json');await ready();
  await canvas.screenshot({path:'output/playwright/hba-image-imported.png'});
  download=page.waitForEvent('download');await page.getByRole('button',{name:'Export image',exact:true}).click();await(await download).saveAs('data/benchmarks/hba_native/browser-teaching-fixture.zip');
  await page.screenshot({path:'output/playwright/hba_native-hba-image.png'});
  const graphics=await canvas.evaluate(canvas=>{const gl=canvas.getContext('webgl2');return {error:gl.getError(),maximum_3d_texture:gl.getParameter(gl.MAX_3D_TEXTURE_SIZE)}});
  assert(!errors.length&&!external.length&&graphics.error===0,errors.concat(external).join('\n'));
  page.off('pageerror',onError);await page.unroute('**/*');
  return {status:'passed',initial_load_ms:loadedAt-started,package_version:manifest.package_version,probes,graphics,page_errors:errors,external_requests:external,checks:['original source image grid','original voxel values','contrast-independent samples','full sections and magnification','scene restore and import','attributable teaching export']};
  };
  return {status:'retired',dataset_id:'hba_native',reason:'HumanBrainAtlas is excluded from the current application; original files and this historical verification are retained.'};
}
