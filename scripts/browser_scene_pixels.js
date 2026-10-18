async page => {
  const errors=[]; page.on('pageerror', error=>errors.push(String(error)));
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const ready=async()=>{
    await page.waitForFunction(()=>document.querySelector('.live-status')?.textContent?.startsWith('Ready'),null,{timeout:60000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  await page.reload(); await ready();
  const catalog=await page.evaluate(async()=>(await(await fetch('/api/atlases')).json()).atlases);
  const atlas=catalog.find(value=>value.dataset_id==='spl_nac');
  assert(atlas,'Serve the SPL/NAC package for the real-pointer scene fixture.');
  await page.getByLabel('Local atlas',{exact:true}).selectOption(atlas.key); await ready();
  await page.getByRole('button',{name:'Reset view',exact:true}).click(); await ready();
  await page.getByRole('button',{name:'Inspect',exact:true}).click();
  await page.locator('button[title="spl_nac:label:12"]').click(); await ready();
  await page.getByRole('button',{name:'Isolate selected',exact:true}).click();
  await page.getByLabel('MRI contrast',{exact:true}).selectOption('t2'); await ready();
  const zoomControl=page.getByLabel('3D zoom',{exact:true}), zoomBox=await zoomControl.boundingBox();
  await page.mouse.click(zoomBox.x+zoomBox.width*.25,zoomBox.y+zoomBox.height*.5); await ready();
  const initialZoom=Number(await zoomControl.inputValue());
  assert(initialZoom>2,'The visible zoom control did not magnify beyond the old limit.');
  await page.getByLabel('Scene teaching notes').fill('Real-pointer camera, zoom and slice-pan restoration fixture.');
  const canvas=page.locator('canvas'), box=await canvas.boundingBox();
  assert(box&&box.width>600&&box.height>400,'Use the documented 1600 by 1050 desktop viewport.');
  await canvas.screenshot({path:'output/playwright/scene-pose-baseline.png'});
  const x=box.x+box.width*.76,y=box.y+box.height*.75;
  await page.mouse.move(x,y); await page.mouse.down();
  await page.mouse.move(x+67,y-34,{steps:16}); await page.mouse.up(); await ready();
  await page.mouse.move(x+40,y); await page.mouse.wheel(0,-500); await ready();
  const sx=box.x+box.width*.27,sy=box.y+box.height*.28;
  await page.mouse.move(sx,sy); await page.mouse.down({button:'middle'});
  await page.mouse.move(sx+36,sy+23,{steps:12}); await page.mouse.up({button:'middle'}); await ready();
  await page.locator('.workspace-heading h1').click(); await ready();
  await canvas.screenshot({path:'output/playwright/scene-pose-interactive.png'});
  await page.getByRole('button',{name:'Save scene',exact:true}).click();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)||'null')?.state?.note?.startsWith('Real-pointer'),atlas.key);
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)),atlas.key);
  assert(saved.state.camera.slice(0,2).some((v,i)=>Math.abs(v-[110,15][i])>.1),'Actual 3D rotation did not change the captured camera.');
  assert(saved.state.camera[2]>2 && saved.state.camera[2]<initialZoom,'Wheel zoom did not preserve an independent close view above the old 2× limit.');
  assert(saved.state.pan.slice(0,3).some(v=>Math.abs(v)>1),'Actual middle-button drag did not change the captured slice pan.');
  await canvas.screenshot({path:'output/playwright/scene-pose-saved.png'});
  await page.getByRole('button',{name:'Reset view',exact:true}).click(); await ready();
  await canvas.screenshot({path:'output/playwright/scene-pose-reset.png'});
  await page.getByRole('button',{name:'Restore saved',exact:true}).click(); await ready();
  await canvas.screenshot({path:'output/playwright/scene-pose-restored.png'});
  const path='data/exports/spl_nac/browser-validation/camera-scene.json';
  const download=page.waitForEvent('download'); await page.getByRole('button',{name:'Export scene',exact:true}).click();
  await(await download).saveAs(path);
  await page.reload(); await ready();
  await page.getByLabel('Import scene file',{exact:true}).setInputFiles(path); await ready();
  await canvas.screenshot({path:'output/playwright/scene-pose-imported.png'});
  assert(!errors.length,errors.join('\n'));
  return {status:'passed',package_version:saved.package_version,camera:saved.state.camera,pan:saved.state.pan,
    position_ras_mm:saved.state.position,selected:saved.state.selected,
    checks:['real 3D rotation and wheel zoom above 2×','real slice pan','scene save after pointer input','saved scene recovery','portable import after reload'],page_errors:errors};
}
