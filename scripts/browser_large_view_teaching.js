async page => {
  const errors=[], external=[], exports=[];
  page.on('pageerror',error=>errors.push(String(error)));
  const assert=(value,message)=>{if(!value)throw new Error(message);};
  const origin=new URL(page.url()).origin;
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();external.push(route.request().url());return route.abort();});
  const ready=async()=>{
    await page.waitForFunction(()=>/^(Ready|Notebook scene restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:60000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  await page.reload();await ready();
  const {key,book}=await page.evaluate(async()=>{
    const api=await(await fetch('/api/atlases')).json();
    if(!api.startup)throw new Error('Serve a prepared six-scene notebook.');
    return{key:api.startup.atlas_key,book:await(await fetch(api.startup.content_url)).json()};
  });
  assert(book.scenes.length===6,'Use the accepted six-view brainstem notebook.');
  const storage='neuroimage:notebook:primary:'+key;
  assert(await page.evaluate(key=>localStorage.getItem(key),storage)===null,'Use an isolated browser profile; existing notebook retained.');
  const sentinel=JSON.stringify({...book,id:'large-view-saved-notebook',title:'Preserved notebook fixture'});
  await page.evaluate(({key,value})=>localStorage.setItem(key,value),{key:storage,value:sentinel});
  try{
    await page.getByRole('button',{name:'Expand viewer',exact:true}).click();
    await page.getByRole('button',{name:'Learning tools',exact:true}).click();
    assert(await page.getByRole('region',{name:'Notebook presentation'}).isVisible(),'Teaching presentation is unavailable in expanded viewing.');
    for(let index=0;index<6;index++){
      await page.waitForFunction(number=>document.querySelector('.notebook-presentation .lesson-progress')?.textContent?.startsWith('Scene '+number+' of'),index+1);
      await ready();
      const actual=await Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
      assert(actual.every((value,axis)=>Math.abs(value-book.scenes[index].scene.state.position[axis])<.011),'Expansion changed a recorded source coordinate.');
      assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue())===1,'Prepared teaching lost full-section context.');
      if(index===0){
        await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();
        await page.getByRole('button',{name:'Return to recorded view',exact:true}).click();await ready();
        assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue())===1,'Return to recorded view lost the full section.');
      }
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();
      const file='data/exports/brainstem_navigator_mni/large-view-acceptance/teaching-'+(index+1)+'.zip';
      await(await download).saveAs(file);exports.push(file.replace(/^data\//,''));
      assert(await page.evaluate(key=>localStorage.getItem(key),storage)===sentinel,'Expanded teaching overwrote the saved browser notebook.');
      if(index<5)await page.getByRole('button',{name:'Next view',exact:true}).click();
    }
    await page.getByRole('button',{name:'Close learning tools',exact:true}).click();
    await page.keyboard.press('Escape');await ready();
    assert((await page.getByRole('region',{name:'Notebook presentation'}).textContent()).includes('Scene 6 of 6'),'Exiting expanded view lost teaching progress.');
    assert(!errors.length&&!external.length,'Expanded teaching had page errors or external requests.');
    return{status:'passed',package_key:key,notebook_id:book.id,scenes:6,exports,saved_browser_notebook:'unchanged',recorded_view:'restored after magnification',exit_teaching_progress:'scene 6 retained',page_errors:errors,external_requests:external};
  }finally{await page.evaluate(key=>localStorage.removeItem(key),storage);}
}
