async page=>{
  const origin=new URL(page.url()).origin,id=new URL(page.url()).searchParams.get('course'),errors=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  const ready=async()=>{
    await page.waitForFunction(()=>!document.querySelector('.course-presentation')?.textContent?.includes('Opening the recorded source view…')&&/^(Ready|Model scene saved|Scene saved)/.test(document.querySelector('[aria-label="Primary atlas workspace"] .live-status,[aria-label="Primary atlas workspace"] .model-status')?.textContent??''),null,{timeout:120000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(),'A source or course reported an error.');
  };
  await ready();
  assert(await page.evaluate(()=>localStorage.getItem('neuroimage:course-editor-draft:v1'))===null,'Use a fresh browser profile to verify data-drive recovery.');
  const saved=await(await page.request.get(origin+'/api/workspace/courses/'+id)).json();
  assert(saved.position===17,'Service restart lost the persisted course position.');
  assert(await page.getByLabel('Course presentation view',{exact:true}).inputValue()===saved.course.entries[17].id,'Fresh browser did not restore the recorded course view.');
  const primary=page.getByRole('region',{name:'Primary atlas workspace',exact:true});
  assert((await primary.locator('.compact-selection').innerText()).includes('A0101'),'Service recovery opened a different source.');
  await page.getByText('Compare another recorded view',{exact:true}).click();
  await page.getByLabel('Recorded comparison view',{exact:true}).selectOption(saved.course.entries[0].id);
  await ready();
  const comparison=page.getByRole('region',{name:'Comparison atlas workspace',exact:true});
  await page.waitForFunction(()=>document.querySelector('[aria-label="Comparison atlas workspace"] .live-status')?.textContent?.startsWith('Ready'),null,{timeout:120000});
  const coordinates=()=>Promise.all(['R','A','S'].map(axis=>comparison.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  const before=await coordinates(),expected=saved.course.entries[0].scene.state.position;
  assert(before.every((value,axis)=>Math.abs(value-expected[axis])<.011),'The comparison source position changed.');
  assert((await(await page.request.get(origin+'/api/workspace/courses/'+id)).json()).position===17,'Opening comparison moved the main course position.');
  await page.getByLabel('Course presentation view',{exact:true}).selectOption(saved.course.entries[8].id);await ready();
  assert(JSON.stringify(await coordinates())===JSON.stringify(before),'Advancing the lesson moved its independent comparison.');
  assert((await comparison.locator('.compact-selection').innerText()).includes('Left Area 4a'),'The independent comparison selection changed.');
  await page.screenshot({path:'data/benchmarks/course-integration/'+id+'/independent-course-comparison.png'});
  await page.getByRole('checkbox',{name:'Compare native spaces',exact:true}).uncheck();
  assert(await comparison.count()===0,'Comparison renderer remained mounted after closing it.');
  await page.getByRole('checkbox',{name:'Compare native spaces',exact:true}).check();
  await page.waitForFunction(()=>document.querySelector('[aria-label="Comparison atlas workspace"] .live-status')?.textContent?.startsWith('Ready'),null,{timeout:120000});
  assert(JSON.stringify(await coordinates())===JSON.stringify(before),'Reopening comparison lost its source position.');
  await page.getByRole('checkbox',{name:'Compare native spaces',exact:true}).uncheck();
  await page.getByRole('button',{name:'Restore view',exact:true}).click();await ready();
  await primary.getByRole('button',{name:'Save scene',exact:true}).click();
  const original=saved.course.entries[8].scene;
  const scene=await page.evaluate(binding=>Object.keys(localStorage).filter(key=>key.startsWith('neuroimage:model:primary:')).map(key=>JSON.parse(localStorage.getItem(key))).filter(value=>value.build_signature===binding.build_signature).sort((a,b)=>b.saved_utc.localeCompare(a.saved_utc))[0],original);
  assert(scene.state.focus_native_mm===original.state.focus_native_mm&&JSON.stringify(scene.state.camera)===JSON.stringify(original.state.camera),'Recorded full model context changed.');
  page.off('pageerror',onError);assert(!errors.length,errors.join('\n'));
  return {status:'passed',course_id:id,restored_position:17,final_position:8,comparison_source:saved.course.entries[0].scene.package_id,
    checks:['Service restart with the same data root','New browser profile with no local course draft','Exact recorded main-source recovery','Open a recorded comparison in its native space','Comparison leaves saved main position unchanged','Main source navigation leaves comparison coordinates and selection unchanged','Close/reopen comparison','Restore recorded model camera and whole-view context'],page_errors:errors};
}
