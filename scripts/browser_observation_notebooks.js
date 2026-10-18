async page => {
  const origin=new URL(page.url()).origin,errors=[],external=[],reports=[];
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  const onError=e=>errors.push(String(e));page.on('pageerror',onError);
  await page.unroute('**/*');await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  const ready=async()=>{await page.waitForFunction(()=>/^(Ready|Notebook scene restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:120000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(!await page.locator('.error[role=alert]').count(),'The viewer reported an error.');};
  const point=()=>Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  const fixtures=[['hba_native','hba-native-t2-observation',6],['mesoveins','mesoveins-native-observation',4],['venat','venat-native-field-comparison',8],['mug500_healthy','mug500-skull-observation',4]];
  for(const [dataset,curriculum,count] of fixtures){
    await page.goto(origin);await page.getByRole('button',{name:'Browse Whole brain',exact:true}).waitFor();
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Browse Whole brain"]')?.disabled);
    const catalog=await page.evaluate(async()=>await(await fetch('/api/workspace')).json());
    const source=catalog.sources.find(s=>s.id===dataset),target=catalog.packages.filter(p=>p.dataset_id===dataset&&p.status==='available'&&p.compatible_curricula.includes(curriculum)).sort((a,b)=>b.created_utc.localeCompare(a.created_utc))[0];
    assert(source&&target,'No compatible source package for '+curriculum);
    await page.getByRole('button',{name:source.title+' Atlas ready',exact:true}).click();
    await page.getByRole('button',{name:'Download, install and build',exact:true}).click();
    await page.getByRole('button',{name:'Local atlases',exact:true}).click();
    const row=page.locator('.local-package').filter({has:page.locator('code',{hasText:target.package_version})});
    await row.getByLabel('Teaching recipe for '+target.key).selectOption(curriculum);
    const response=page.waitForResponse(r=>r.url()===origin+'/api/workspace/jobs'&&r.request().method()==='POST');
    await row.getByRole('button',{name:'Prepare teaching',exact:true}).click();
    const result=await response,job=await result.json();assert(result.status()===202,'Preparation was rejected.');
    await page.waitForFunction(id=>document.querySelector('[aria-label="Operation '+id+'"] .job-status')?.textContent==='complete',job.id,{timeout:120000});
    const book=await page.evaluate(async id=>(await(await fetch('/api/workspace/content/'+id)).json()).content,job.id);
    assert(book.scenes.length===count,'Prepared scene count changed.');
    assert(book.scenes.every(s=>s.scene.state.focus3D===undefined),'Explicit broad 3D context was lost.');
    assert(book.scenes.every(s=>s.scene.state.tileLayout==='row'),'Complete-section row layout was lost.');
    await page.getByRole('article',{name:'Operation '+job.id,exact:true}).getByRole('link',{name:'Open prepared notebook',exact:true}).click();await ready();
    assert(await page.getByRole('region',{name:'Notebook presentation',exact:true}).isVisible(),'Opening a requested notebook did not show its prompts.');
    const storage='neuroimage:notebook:primary:'+target.key,previous=await page.evaluate(key=>localStorage.getItem(key),storage);
    const output='data/exports/'+dataset+'/observation-browser-'+book.id,views=[];
    const exportImage=async name=>{const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await download).saveAs(output+'/'+name+'.zip')};
    for(let index=0;index<book.scenes.length;index++){
      await ready();const entry=book.scenes[index],actual=await point();
      assert(actual.every((v,i)=>Math.abs(v-entry.scene.state.position[i])<.011),'The source point changed.');
      assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue())===entry.scene.state.pan[3],'Recorded full-section or magnified display changed.');
      assert(await page.getByLabel('Image panel arrangement',{exact:true}).inputValue()==='row','The browser did not restore the recorded section arrangement.');
      await exportImage('view-'+(index+1));
      if(index===0||dataset==='hba_native')await page.screenshot({path:'output/playwright/observation-'+dataset+'-'+(index+1)+'.png'});
      if(index===0){
        await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();assert(JSON.stringify(await point())===JSON.stringify(actual),'Magnification moved the source point.');await exportImage('view-1-magnified');
        await page.getByRole('button',{name:'Return to recorded view',exact:true}).click();await ready();
      }
      assert(await page.evaluate(key=>localStorage.getItem(key),storage)===previous,'Presentation overwrote a saved notebook.');
      views.push({title:entry.title,position_ras_mm:actual,background:entry.scene.state.background,zoom:entry.scene.state.pan[3],export:output.replace(/^data\//,'')+'/view-'+(index+1)+'.zip'});
      if(index+1<count)await page.getByRole('button',{name:'Next view',exact:true}).click();
    }
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export notebook',exact:true}).click();await(await download).saveAs(output+'/teaching-notebook.json');
    await page.getByLabel('Import teaching notebook file',{exact:true}).setInputFiles(output+'/teaching-notebook.json');await page.getByRole('button',{name:'Present notebook',exact:true}).click();await ready();
    assert((await point()).every((v,i)=>Math.abs(v-book.scenes[0].scene.state.position[i])<.011),'Portable notebook did not recover its first point.');
    assert(await page.evaluate(key=>localStorage.getItem(key),storage)===previous,'Import overwrote a saved notebook.');
    reports.push({dataset,curriculum,package_version:target.package_version,notebook_id:book.id,preparation_job:job.id,scenes:views,portable_notebook:output.replace(/^data\//,'')+'/teaching-notebook.json'});
  }
  page.off('pageerror',onError);await page.unroute('**/*');assert(!errors.length&&!external.length,errors.concat(external).join('\n'));
  return {status:'passed',reports,page_errors:errors,external_requests:external,checks:['dataset-scoped preparation','explicit teaching startup','unchanged native coordinates','global and same-point enlarged sections','broad 3D context','source-bound image and notebook export','portable import','prior saved notebook preservation']};
}
