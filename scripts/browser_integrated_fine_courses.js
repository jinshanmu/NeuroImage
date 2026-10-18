async page => {
  const url=new URL(page.url()),origin=url.origin,errors=[],external=[],verified=[],captures=new Set();
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.unroute('**/*');await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  const catalog=await(await page.request.get(origin+'/api/workspace')).json();
  const courseIds={"integrated-brainstem-cranial-anatomy": "322d12c8-9249-5e4a-9d75-9e10717c9c93", "integrated-cerebellar-fine-anatomy": "c0a02857-e90c-5c08-845e-5435d09cf43c", "integrated-cortical-surface-layers": "ba60350a-cc32-5f2a-9f5b-2ef0833a655f", "integrated-hippocampal-fine-anatomy": "fab66d9f-7baf-551e-99a5-6ecbab162ee8"};
  const plans=catalog.course_plans.filter(item=>courseIds[item.id]);
  const ready=async()=>{
    await page.waitForFunction(()=>!document.querySelector('.course-presentation')?.textContent?.includes('Opening the recorded source view…')&&/^(Ready|Scene saved|Model scene saved)/.test(document.querySelector('[aria-label="Primary atlas workspace"] .live-status,[aria-label="Primary atlas workspace"] .model-status')?.textContent??''),null,{timeout:120000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(),'A source view reported an error.');
  };
  for(const plan of plans){
    const id=courseIds[plan.id],saved=await(await page.request.get(origin+'/api/workspace/courses/'+id)).json(),entries=saved.course.entries;
    await page.goto(origin+'/?course='+id);await ready();
    for(let index=0;index<entries.length;index++){
      const entry=entries[index],expected=entry.scene,model=expected.state.kind==='source-model-view';
      if(await page.getByLabel('Course presentation view',{exact:true}).inputValue()!==entry.id){await page.getByLabel('Course presentation view',{exact:true}).selectOption(entry.id);await ready();}
      const primary=page.getByRole('region',{name:'Primary atlas workspace',exact:true});
      const output='data/benchmarks/integration/fine-anatomy-20261014/advanced-courses/'+plan.id;
      // Retain actual settled scenes as portable files. Long course acceptance
      // must not depend on the browser's small optional local-storage quota.
      const sceneDownload=page.waitForEvent('download');
      await primary.getByRole('button',{name:'Export scene',exact:true}).click();
      const scenePath=output+'/'+entry.id+'-scene.json';
      await(await sceneDownload).saveAs(scenePath);
      if(!captures.has(expected.package_id)){
        const canvas=primary.locator('canvas');await canvas.screenshot({path:output+'/'+expected.package_id+'-first-view.png'});
        const event=page.waitForEvent('download');await primary.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await event).saveAs(output+'/'+expected.package_id+'-teaching.zip');captures.add(expected.package_id);
      }
      verified.push({plan:plan.id,course_id:id,entry:entry.id,title:entry.title,package_id:expected.package_id,package_version:expected.package_version,space_id:expected.space_id,scene:scenePath.replace(/^data\//,'')});
    }
    assert((await(await page.request.get(origin+'/api/workspace/courses/'+id)).json()).position===entries.length-1,'Last viewed course position was not saved.');
    await page.screenshot({path:'data/benchmarks/integration/fine-anatomy-20261014/advanced-courses/'+plan.id+'/course-workspace.png'});
  }
  page.off('pageerror',onError);await page.unroute('**/*');assert(!errors.length&&!external.length,errors.concat(external).join('\n'));
  assert(plans.length===4&&verified.length===82,'Every integrated fine-anatomy course view must be visited.');
  return {status:'passed',course_count:plans.length,verified_views:verified.length,source_count:captures.size,verified,page_errors:errors,external_requests:external};
}
