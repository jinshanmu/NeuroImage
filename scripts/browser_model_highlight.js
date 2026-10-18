async page => {
  const origin=new URL(page.url()).origin,errors=[],assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=e=>errors.push(String(e));page.on('pageerror',onError);
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('.model-status')?.textContent?.startsWith('Ready'),null,{timeout:60000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('[aria-label="Browse Arteries and veins"]')?.disabled);
  await page.getByRole('combobox',{name:'Source for Arteries and veins',exact:true}).selectOption('z_anatomy');
  await page.getByRole('button',{name:'Browse Arteries and veins',exact:true}).click();await ready();
  const toggle=page.getByRole('checkbox',{name:'Highlight selected',exact:true});
  assert(await toggle.isChecked(),'New model view does not highlight selection.');
  await page.getByRole('button',{name:'Learning tools',exact:true}).click();await page.getByRole('button',{name:'Learn',exact:true}).click();
  await page.getByRole('combobox',{name:'Model lesson',exact:true}).selectOption('NI-Z102');await ready();
  await page.getByRole('button',{name:'Next structure',exact:true}).click();await ready();
  const canvas=page.getByLabel('Independent native source model',{exact:true});
  await canvas.screenshot({path:'output/playwright/model-highlight-on.png'});
  await toggle.uncheck();await ready();await canvas.screenshot({path:'output/playwright/model-highlight-off.png'});
  await toggle.check();await ready();await page.getByRole('button',{name:'Save scene',exact:true}).click();
  let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs('output/playwright/model-highlight-scene.json');
  await toggle.uncheck();await ready();await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
  assert(await toggle.isChecked(),'Scene restore lost selection highlighting.');await canvas.screenshot({path:'output/playwright/model-highlight-restored.png'});
  await toggle.uncheck();await ready();await page.getByLabel('Import model scene file',{exact:true}).setInputFiles('output/playwright/model-highlight-scene.json');await ready();
  assert(await toggle.isChecked(),'Portable import lost selection highlighting.');await canvas.screenshot({path:'output/playwright/model-highlight-imported.png'});
  download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await download).saveAs('data/benchmarks/z_anatomy/highlight-teaching-export.zip');
  await page.screenshot({path:'output/playwright/model-highlight-teaching.png'});
  const key=await page.getByRole('combobox',{name:'Source',exact:true}).inputValue();
  page.off('pageerror',onError);assert(!errors.length,errors.join('\n'));
  return {status:'passed',source:key,page_errors:errors,checks:['new selection highlight','source color toggle','scene restoration','portable scene import','attributed export']};
}
