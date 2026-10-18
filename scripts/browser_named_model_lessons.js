async page => {
  const origin=new URL(page.url()).origin,errors=[],assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=e=>errors.push(String(e));page.on('pageerror',onError);
  const ready=async()=>{await page.waitForFunction(()=>document.querySelector('.model-status')?.textContent?.startsWith('Ready'),null,{timeout:60000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))};
  await page.goto(origin);await page.waitForFunction(()=>!document.querySelector('[aria-label="Browse Arteries and veins"]')?.disabled);
  await page.getByRole('combobox',{name:'Source for Arteries and veins',exact:true}).selectOption('z_anatomy');
  await page.getByRole('button',{name:'Browse Arteries and veins',exact:true}).click();await ready();
  const key=await page.getByRole('combobox',{name:'Source',exact:true}).inputValue();
  const source=await page.evaluate(async key=>{const atlas=(await(await fetch('/api/atlases')).json()).atlases.find(a=>a.key===key);const manifest=await(await fetch(atlas.manifest_url)).json();const lessons=(await(await fetch(atlas.base_url+manifest.lessons_file)).json()).lessons;return {manifest,lessons}},key);
  assert(source.lessons.length===14,'Named model paths were not delivered.');
  await page.getByRole('button',{name:'Notes, lessons and sources',exact:true}).click();await page.getByRole('button',{name:'Lessons',exact:true}).click();
  const storage='neuroimage:model:primary:'+key+':vascular-anatomy',records=[];
  for(const id of ['NI-Z101','NI-Z102','NI-Z103','NI-Z201','NI-Z301','NI-Z302','NI-Z401','NI-Z402']){
    const lesson=source.lessons.find(l=>l.id===id);
    await page.getByRole('combobox',{name:'Model lesson',exact:true}).selectOption(id);await ready();
    await page.getByRole('textbox',{name:'Model lesson response',exact:true}).fill('Inspect the named source object with its original context.');
    await page.getByRole('button',{name:'Compare with source answer',exact:true}).click();
    assert((await page.locator('.source-answer').textContent()).includes(lesson.steps[0].answer),'The source explanation was not shown.');
    await page.getByRole('button',{name:'Save scene',exact:true}).click();
    await page.waitForFunction(({key,id})=>JSON.parse(localStorage.getItem(key)||'null')?.state.lesson_id===id,{key:storage,id});
    let saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storage);
    const target=source.manifest.structures.find(s=>s.id===lesson.steps[0].structure_id);
    assert(saved.state.selected===target.id&&JSON.stringify(saved.state.position_native_mm)===JSON.stringify(target.target_native_mm),'Teaching target moved away from its source object.');
    assert(JSON.stringify(saved.state.visible)===JSON.stringify(lesson.structure_ids),'Lesson lost its source model context.');
    await page.getByRole('button',{name:'Next structure',exact:true}).click();await ready();
    await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
    assert(await page.getByRole('textbox',{name:'Model lesson response',exact:true}).inputValue()===saved.state.lesson_answer,'Scene restore lost the lesson response.');
    assert(await page.getByRole('button',{name:'Hide source answer',exact:true}).count()===1,'Scene restore lost the answer reveal state.');
    records.push({id,title:lesson.title,steps:lesson.steps.length,context_objects:lesson.structure_ids.length,first_target:target.id});
  }
  await page.getByRole('combobox',{name:'Model lesson',exact:true}).selectOption('NI-Z102');await ready();
  await page.getByRole('button',{name:'Next structure',exact:true}).click();await ready();
  await page.getByRole('button',{name:'Compare with source answer',exact:true}).click();
  await page.getByRole('textbox',{name:'Model lesson response',exact:true}).fill('Left source insular M2 branches; compare with M1 and M3.');
  await page.getByRole('button',{name:'Save scene',exact:true}).click();
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.state.lesson_step===1,storage);
  let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs('output/playwright/named-model-lesson-scene.json');
  await page.screenshot({path:'output/playwright/named-model-lesson-mca.png'});
  download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await download).saveAs('data/benchmarks/z_anatomy/named-model-lesson-export.zip');
  await page.getByRole('combobox',{name:'Model lesson',exact:true}).selectOption('NI-Z301');await ready();
  await page.getByLabel('Import model scene file',{exact:true}).setInputFiles('output/playwright/named-model-lesson-scene.json');await ready();
  assert(await page.getByRole('combobox',{name:'Model lesson',exact:true}).inputValue()==='NI-Z102','Portable import lost the lesson.');
  assert(await page.getByRole('textbox',{name:'Model lesson response',exact:true}).inputValue()==='Left source insular M2 branches; compare with M1 and M3.','Portable import lost the learner response.');
  await page.screenshot({path:'output/playwright/named-model-lesson-imported.png'});
  page.off('pageerror',onError);assert(!errors.length,errors.join('\n'));
  return {status:'passed',package_version:source.manifest.package_version,paths:records,advanced_steps:records.reduce((sum,r)=>sum+r.steps,0),page_errors:errors,checks:['eight named source paths','retained context objects','exact source targets','step-specific explanations','response and reveal recovery','portable lesson scene','attributed export']};
}
