async page => {
  const url=new URL(page.url()),origin=url.origin;
  const choices=JSON.parse(url.searchParams.get('course-packages')??'{}');
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const catalog=await(await page.request.get(origin+'/api/workspace')).json();
  const plans=catalog.course_plans.filter(plan=>!url.searchParams.has('plan')||plan.id===url.searchParams.get('plan'));
  const errors=[],results=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.getByRole('button',{name:'Teaching library',exact:true}).click();
  for(const plan of plans){
    await page.getByLabel('Course plan',{exact:true}).selectOption(plan.id);
    for(const source of plan.requirements){assert(choices[source.dataset_id],'Provide an explicit verified package choice for '+source.dataset_id);await page.getByLabel('Course source '+source.dataset_id,{exact:true}).selectOption(choices[source.dataset_id]);}
    const previous=await page.evaluate(()=>JSON.parse(localStorage.getItem('neuroimage:course-plan-preparation:v1')??'{}').job);
    await page.getByRole('button',{name:'Prepare course',exact:true}).click();
    await page.waitForFunction(previous=>{const value=JSON.parse(localStorage.getItem('neuroimage:course-plan-preparation:v1')??'{}');return value.job&&value.job!==previous},previous,{timeout:15000});
    const id=await page.evaluate(()=>JSON.parse(localStorage.getItem('neuroimage:course-plan-preparation:v1')).job);
    await page.waitForFunction(()=>!['Preparing source views','running','stopping'].includes(document.querySelector('.course-preparation-status strong')?.textContent??'running'),null,{timeout:600000});
    const job=await(await page.request.get(origin+'/api/workspace/jobs/'+id)).json();
    assert(job.status==='complete',JSON.stringify(job));
    assert(job.result.views===plan.views,'Prepared course view count changed.');
    assert(job.result.source_count===plan.requirements.length,'Prepared course source count changed.');
    const saved=await(await page.request.get(origin+'/api/workspace/courses/'+job.result.course_id)).json();
    assert(saved.locations.every(item=>item.status==='ready'),'A course selected an unavailable source.');
    results.push({plan:plan.id,job:id,course_id:job.result.course_id,views:job.result.views,sources:job.result.source_count,status:job.result.status,revision:saved.revision});
  }
  await page.screenshot({path:'output/playwright/course-plan-preparation.png',fullPage:false});
  page.off('pageerror',onError);assert(!errors.length,errors.join('\n'));
  return {status:'passed',results,page_errors:errors};
}
