async page => {
  const url=new URL(page.url()),origin=url.origin,errors=[],external=[],verified=[],captures=new Set();
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.unroute('**/*');await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  const catalog=await(await page.request.get(origin+'/api/workspace')).json();
  const requested=url.searchParams.get('plan');
  const plans=catalog.course_plans.filter(item=>!requested||item.id===requested);
  const ready=async()=>{
    await page.waitForFunction(()=>!document.querySelector('.course-presentation')?.textContent?.includes('Opening the recorded source view…')&&/^(Ready|Scene saved|Model scene saved)/.test(document.querySelector('[aria-label="Primary atlas workspace"] .live-status,[aria-label="Primary atlas workspace"] .model-status')?.textContent??''),null,{timeout:120000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(),'A source view reported an error.');
  };
  for(const plan of plans){
    const job=catalog.jobs.find(item=>item.status==='complete'&&item.request.course_plan===plan.id);
    assert(job?.result?.course_id,'Prepare the installed course plan first: '+plan.id);
    const id=job.result.course_id,saved=await(await page.request.get(origin+'/api/workspace/courses/'+id)).json(),entries=saved.course.entries;
    await page.goto(origin+'/?course='+id);await ready();
    for(let index=0;index<entries.length;index++){
      const entry=entries[index],expected=entry.scene,model=expected.state.kind==='source-model-view';
      if(await page.getByLabel('Course presentation view',{exact:true}).inputValue()!==entry.id){await page.getByLabel('Course presentation view',{exact:true}).selectOption(entry.id);await ready();}
      const primary=page.getByRole('region',{name:'Primary atlas workspace',exact:true});
      await primary.getByRole('button',{name:'Save scene',exact:true}).click();
      await page.waitForFunction(()=>/^(Scene saved|Model scene saved)/.test(document.querySelector('[aria-label="Primary atlas workspace"] .live-status,[aria-label="Primary atlas workspace"] .model-status')?.textContent??''));
      const state=await page.evaluate(({expected,model})=>{
        const prefix=model?'neuroimage:model:primary:':'neuroimage:scene:';
        return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>JSON.parse(localStorage.getItem(key))).filter(value=>value.build_signature===expected.build_signature).sort((a,b)=>b.saved_utc.localeCompare(a.saved_utc))[0];
      },{expected,model});
      assert(state?.space_id===expected.space_id&&state.package_version===expected.package_version,plan.id+': source binding changed');
      const fields=model?['selected','visible','position_native_mm','camera','focus_native_mm','surfaceOpacity','surfaceCutaway','highlightSelected']:['selected','visible','position','background','radiological','pan','camera','focus3D','surfaceOpacity','surfaceCutaway','sectionPlanes','overlay'];
      for(const field of fields)assert(JSON.stringify(state.state[field])===JSON.stringify(expected.state[field]),plan.id+' / '+entry.id+': changed '+field);
      const output='data/benchmarks/course-plans/'+plan.id;
      if(!captures.has(expected.package_id)){
        const canvas=primary.locator('canvas');await canvas.screenshot({path:output+'/'+expected.package_id+'-first-view.png'});
        const event=page.waitForEvent('download');await primary.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await event).saveAs(output+'/'+expected.package_id+'-teaching.zip');captures.add(expected.package_id);
      }
      verified.push({plan:plan.id,course_id:id,entry:entry.id,title:entry.title,package_id:expected.package_id,package_version:expected.package_version,space_id:expected.space_id,position:state.state.position??state.state.position_native_mm});
    }
    assert((await(await page.request.get(origin+'/api/workspace/courses/'+id)).json()).position===entries.length-1,'Last viewed course position was not saved.');
    await page.screenshot({path:'data/benchmarks/course-plans/'+plan.id+'/course-workspace.png'});
  }
  page.off('pageerror',onError);await page.unroute('**/*');assert(!errors.length&&!external.length,errors.concat(external).join('\n'));
  return {status:'passed',course_count:plans.length,verified_views:verified.length,source_count:captures.size,verified,page_errors:errors,external_requests:external};
}
