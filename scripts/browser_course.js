async page => {
  const origin=new URL(page.url()).origin,errors=[],external=[],views=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);await page.unroute('**/*');
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  const primary=page.getByRole('region',{name:'Primary atlas workspace',exact:true});
  const ready=async()=>{
    await page.waitForFunction(()=>{const slot=document.querySelector('[aria-label="Primary atlas workspace"]');return !document.querySelector('.course-presentation')?.textContent?.includes('Opening the recorded source view…')&&/^(Ready|Scene saved|Recorded model view|Source-bound|Teaching export prepared)/.test(slot?.querySelector('.live-status,.model-status')?.textContent??'');},null,{timeout:120000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(),'The course or source viewer reported an error.');
  };
  await page.goto(origin);await page.getByRole('button',{name:'Teaching library',exact:true}).click();
  assert(!await page.evaluate(()=>localStorage.getItem('neuroimage:course-editor-draft:v1')),'Use an isolated acceptance profile; retain the existing course draft.');
  await page.getByRole('button',{name:'New course',exact:true}).click();
  await page.getByRole('textbox',{name:'Course title',exact:true}).fill('Source anatomy classroom acceptance');
  await page.getByRole('textbox',{name:'Course author',exact:true}).fill('NeuroImage engineering acceptance');
  await page.getByRole('textbox',{name:'Course objective',exact:true}).fill('Explore source cortical assignments, native nerve models and skull context, retaining each source space.');
  const library=await(await page.request.get(origin+'/api/workspace/teaching')).json();
  for(const id of ['julich-central-cortex','z-anatomy-nerve-roots','mug500-source-skull-context']){
    const record=library.records.find(item=>item.relative_path.includes('/'+id+'-'));assert(record,'Source teaching is unavailable: '+id);
    await page.getByRole('searchbox',{name:'Search teaching library',exact:true}).fill(record.title);
    await page.getByRole('article',{name:record.title,exact:true}).getByRole('button',{name:'Add to course',exact:true}).click();
    await page.getByRole('button',{name:'Add to course',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(title=>JSON.parse(localStorage.getItem('neuroimage:course-editor-draft:v1')??'null')?.course.entries.some(entry=>entry.title===title),record.title.includes('whole surface')?'Complete source skull':id==='julich-central-cortex'?'Left Area 4a (PreCG)':'Left Trigeminal nerve (V)');
  }
  const list=page.getByRole('list',{name:'Course views',exact:true});
  assert(await list.getByRole('listitem').count()===18,'The source notebook scenes were not added intact.');
  await list.getByRole('button').nth(17).click();
  await page.getByRole('textbox',{name:'Course view prompt',exact:true}).fill('Inspect the original skull interior and restore the whole model for context.');
  await page.getByRole('button',{name:'Move course view earlier',exact:true}).click();
  await page.getByRole('button',{name:'Remove course view',exact:true}).click();
  await page.getByRole('button',{name:'Undo course view removal',exact:true}).click();
  await page.getByRole('button',{name:'Save course',exact:true}).click();
  await page.getByRole('button',{name:'Present course',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('neuroimage:course-editor-draft:v1')??'null')?.dirty===false);
  const draft=await page.evaluate(()=>JSON.parse(localStorage.getItem('neuroimage:course-editor-draft:v1')));
  const saved=await(await page.request.get(origin+'/api/workspace/courses/'+draft.course.id)).json();
  assert(saved.course.entries.length===18&&saved.locations.every(item=>item.status==='ready'),'Saved source course identity failed.');
  assert(saved.course.entries[16].prompt.startsWith('Inspect the original skull'),'Course reordering or undo lost the edited prompt.');
  const output='data/benchmarks/course-integration/'+saved.course.id;
  await page.screenshot({path:output+'/course-organizer.png'});
  let event=page.waitForEvent('download');await page.getByRole('button',{name:'Export course',exact:true}).click();await(await event).saveAs(output+'/portable-course.json');
  await page.getByRole('button',{name:'Present course',exact:true}).click();await ready();
  for(const index of [0,7,8,15,16,17]){
    const entry=saved.course.entries[index];
    await page.getByLabel('Course presentation view',{exact:true}).selectOption(entry.id);await ready();
    await primary.getByRole('button',{name:'Save scene',exact:true}).click();
    const scene=await page.evaluate(binding=>Object.keys(localStorage).filter(key=>key.startsWith('neuroimage:scene:')||key.startsWith('neuroimage:model:')).map(key=>{try{return JSON.parse(localStorage.getItem(key))}catch{return null}}).filter(value=>value?.kind==='neuroimage-scene'&&value.package_id===binding.package_id&&value.build_signature===binding.build_signature).sort((a,b)=>b.saved_utc.localeCompare(a.saved_utc))[0],entry.scene);
    const model=entry.scene.state.kind==='source-model-view';
    for(const key of model?['selected','position_native_mm','visible','surfaceCutaway']:['selected','position','visible','background','pan'])assert(JSON.stringify(scene.state[key])===JSON.stringify(entry.scene.state[key]),'Course view changed '+key+' at '+index);
    const progress=await(await page.request.get(origin+'/api/workspace/courses/'+saved.course.id)).json();assert(progress.position===index,'Course position was not persisted.');
    views.push({index,source:scene.package_id,space:scene.space_id,selected:scene.state.selected});
    if(index===8||index===17)await page.screenshot({path:output+'/course-view-'+index+'.png'});
    if(index===0){
      await primary.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();
      await page.getByRole('button',{name:'Return to course view',exact:true}).click();await ready();
      assert(Number(await primary.getByLabel('2D zoom',{exact:true}).inputValue())===1,'Course return did not restore complete source sections.');
    }
  }
  await page.reload();await ready();
  assert(await page.getByLabel('Course presentation view',{exact:true}).inputValue()===saved.course.entries[17].id,'Browser reload lost the recorded course position.');
  await page.getByRole('button',{name:'Edit course',exact:true}).click();
  assert(await page.getByRole('textbox',{name:'Course title',exact:true}).inputValue()===saved.course.title,'Presentation return lost the saved course.');
  await page.getByLabel('Import course file',{exact:true}).setInputFiles(output+'/portable-course.json');
  await page.getByRole('button',{name:'Save course',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('neuroimage:course-editor-draft:v1')??'null')?.dirty===false);
  await page.getByRole('button',{name:'Present course',exact:true}).click();await ready();
  assert(await page.getByLabel('Course presentation view',{exact:true}).inputValue()===saved.course.entries[17].id,'Portable import lost the retained last-view identity.');
  page.off('pageerror',onError);await page.unroute('**/*');assert(!errors.length&&!external.length,errors.concat(external).join('\n'));
  return {status:'passed',course_id:saved.course.id,revision:saved.revision,views:18,source_count:3,observed:views,recovery_position:17,bookmark:page.url(),output,
    checks:['Build a mixed image/model course from the local teaching library','Preserve independent native source bindings','Edit prompts and reorder','Remove and undo','Explicit server save','Credited metadata export/import','Present across sources','Restore recorded full sections','Recover position after browser reload'],page_errors:errors,external_requests:external};
}
