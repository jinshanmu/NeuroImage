async page => {
  // Development-branch reference: requires the retained scene/import/export footer.
  // This historical workflow is not a formal-release acceptance script.
  const errors=[]; page.on('pageerror',error=>errors.push(String(error)));
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const ready=async()=>{await page.waitForFunction(()=>/^(Ready|Scene saved|Saved scene restored|Scene file restored|Image export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:90000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const tag=new URL(page.url()).searchParams.get('acceptance-output')??'development';assert(/^[a-z0-9-]{1,48}$/.test(tag),'Use a filename-safe output tag.');
  await page.setViewportSize({width:1720,height:1120});await ready();
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();
  await page.locator('button[title="brainstem_navigator_mni:region:RN_l"]').click();await ready();
  await page.getByRole('button',{name:'Isolate selected',exact:true}).click();await page.getByRole('button',{name:'Center 3D on cursor',exact:true}).click();await ready();
  await page.getByRole('button',{name:'Inspect',exact:true}).click();
  const toggle=page.getByLabel('Show 3D cursor',{exact:true}),canvas=page.locator('canvas');
  const point=()=>Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  const original=await point(),prefix='output/playwright/cursor-'+tag+'-';
  for(const layout of ['axial','coronal','sagittal','quad']){
    await page.getByLabel('View layout').selectOption(layout);await toggle.check();await ready();
    await canvas.screenshot({path:prefix+layout+'-shown.png'});
    await toggle.uncheck();await ready();await canvas.screenshot({path:prefix+layout+'-hidden.png'});
    assert(JSON.stringify(await point())===JSON.stringify(original),'Cursor visibility moved the physical source point.');
  }
  const atlas=await page.getByLabel('Local atlas',{exact:true}).inputValue(),key='neuroimage:scene:'+atlas;
  const previous=await page.evaluate(key=>localStorage.getItem(key),key);
  const output='data/exports/brainstem_navigator_mni/cursor-display-'+tag;
  try{
    await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
    const scene=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert(scene.state.show3DCursor===false,'The saved scene lost cursor visibility.');
    await toggle.check();await ready();await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
    assert(!await toggle.isChecked(),'Saved-scene restoration lost cursor visibility.');await canvas.screenshot({path:prefix+'restored.png'});
    let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs(output+'/scene.json');
    await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();assert(await toggle.isChecked(),'Legacy/default scene did not show its 3D cursor.');
    await page.getByLabel('Import scene file').setInputFiles(output+'/scene.json');await ready();assert(!await toggle.isChecked(),'Portable scene import lost cursor visibility.');await canvas.screenshot({path:prefix+'imported.png'});
    download=page.waitForEvent('download');await page.getByRole('button',{name:'Export image',exact:true}).click();await(await download).saveAs(output+'/teaching-image.zip');
    assert(!errors.length,'Cursor control produced browser errors.');
    return{status:'passed',package_version:scene.package_version,position_ras_mm:original,scene,images_prefix:prefix,export:output.replace(/^data\//,'')+'/teaching-image.zip',page_errors:errors};
  }finally{await page.evaluate(({key,previous})=>previous===null?localStorage.removeItem(key):localStorage.setItem(key,previous),{key,previous});}
}
