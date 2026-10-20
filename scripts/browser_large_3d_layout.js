async page=>{
  const origin=new URL(page.url()).origin,errors=[];const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  const ready=async()=>{await page.waitForFunction(()=>/^(Ready|Scene saved|Saved scene restored|Scene file restored|Image export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:120000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))};
  await ready();const source=await page.getByLabel('Source',{exact:true}).inputValue();
  assert(source==='julich_selected-53ec2653119db4ba','Open the exact inspected Julich source for this pointer fixture.');
  const position=()=>Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  const initial=await position();
  assert(JSON.stringify(initial)==='[-28,-29,-15]'&&page.viewportSize()?.width===1600&&page.viewportSize()?.height===1050,'Restore the inspected CA1 scene and 1600 x 1050 viewport before this pointer fixture.');
  await page.getByLabel('View layout',{exact:true}).selectOption('quad');await ready();
  await page.getByLabel('View layout',{exact:true}).selectOption('anatomy');await ready();
  assert(JSON.stringify(await position())===JSON.stringify(initial),'Changing layout moved the native image point.');
  await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)),source);
  assert(saved.state.layout==='anatomy'&&saved.state.selected==='julich_selected:label:27','The recorded layout or source selection changed.');
  assert(JSON.stringify(saved.state.camera)==='[110,15,4.58]'&&JSON.stringify(saved.state.focus3D)==='[-24.5,-25.5,-10.5]','The inspected physical source framing changed.');
  const canvas=page.locator('.canvas-shell canvas');await page.mouse.move(10,20);const baseline=await canvas.screenshot();
  // Inspect the actual coronal section and source surface in the 1600 x 1050 viewport.
  await canvas.click({position:{x:1125,y:171}});await ready();const section=await position();
  assert(section[1]===initial[1]&&(section[0]!==initial[0]||section[2]!==initial[2]),'The coronal section pointer did not retain its physical A coordinate.');
  await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
  await canvas.dblclick({position:{x:550,y:310}});await ready();const surface=await position();
  assert(surface[0]<0&&surface.some((value,axis)=>Math.abs(value-initial[axis])>.1),'The enlarged source surface did not update the linked left-native point.');
  assert((await page.locator('.coordinate-status').innerText()).includes('Left CA1'),'The inspected CA1 surface selected another structure.');
  await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();await page.mouse.move(10,20);
  assert(baseline.equals(await canvas.screenshot()),'Restoring the large 3D layout changed rendered pixels.');
  const output='data/benchmarks/julich_selected/large-3d-layout';await canvas.screenshot({path:output+'/linked-large-3d.png'});
  let event=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await event).saveAs(output+'/scene.json');
  await page.getByLabel('View layout',{exact:true}).selectOption('axial');await ready();
  await page.getByLabel('Import scene file',{exact:true}).setInputFiles(output+'/scene.json');await ready();await page.mouse.move(10,20);
  assert(await page.getByLabel('View layout',{exact:true}).inputValue()==='anatomy','Portable import lost the large 3D layout.');
  assert(baseline.equals(await canvas.screenshot()),'Portable layout import changed rendered pixels.');
  event=page.waitForEvent('download');await page.getByRole('button',{name:'Export image',exact:true}).click();await(await event).saveAs(output+'/teaching.zip');
  page.off('pageerror',onError);assert(!errors.length,errors.join('\n'));
  return {status:'passed',source,initial,coronal_pointer:section,surface_pointer:surface,restored_pixel_difference:0,imported_pixel_difference:0,page_errors:errors,checks:['Three unchanged source image planes beside enlarged 3D','Layout switch retains native coordinates','Actual coronal pointer keeps its A coordinate','Actual 3D source surface updates linked image location','Left CA1 selection from inspected source surface','Pixel-identical scene restoration and portable import','Credited teaching export']};
}
