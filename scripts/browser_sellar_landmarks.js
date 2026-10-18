async page => {
  await page.setViewportSize({width:1920,height:1100});
  const url=new URL(page.url()),origin=url.origin,key=url.searchParams.get('teaching-content');
  const assert=(ok,message)=>{if(!ok)throw Error(message)};
  assert(key,'Open the prepared source annotation notebook with its teaching-content key.');
  const opened=await(await page.request.get(origin+'/api/workspace/teaching/'+key)).json();
  const book=opened.content,output='data/benchmarks/z_anatomy/sellar-landmarks-20261014/browser';
  assert(book.title.endsWith('Sella, clinoid processes and sphenoidal grooves'),'Use the prepared sellar source notebook.');
  assert(book.scenes.length===18,'Expected nine source annotations with two views each.');
  const errors=[],external=[],results=[];const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():(external.push(route.request().url()),route.abort()));
  await page.goto(origin+'/?teaching-content='+key);
  const ready=async()=>{
    await page.waitForFunction(()=>document.querySelector('.model-status')?.textContent?.startsWith('Ready'),null,{timeout:120000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(),'A model source annotation reported an error.');
  };
  await ready();
  const atlasKey=await page.getByRole('combobox',{name:'Source',exact:true}).inputValue();
  const storageKey='neuroimage:model:primary:'+atlasKey+':content:'+key;
  const canvas=page.locator('canvas');
  for(let index=0;index<book.scenes.length;index++){
    if(index){await page.getByRole('button',{name:'Next view',exact:true}).click();await ready();}
    const expected=book.scenes[index].scene.state;
    await page.getByRole('button',{name:'Save scene',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.model-status')?.textContent?.startsWith('Model scene saved'));
    const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),storageKey);
    for(const field of ['selected','visible','position_native_mm','focus_native_mm','camera','opacity','showMarkers','annotations','note']){
      assert(JSON.stringify(saved.state[field])===JSON.stringify(expected[field]),'View '+(index+1)+' changed '+field);
    }
    const annotation=saved.state.annotations[0].source_annotation;
    assert(annotation&&JSON.stringify(saved.provenance.source_annotations)==JSON.stringify([annotation]),'Source annotation provenance was lost during recapture.');
    assert(saved.space_id===book.space_id&&saved.build_signature===book.build_signature,'Native model binding changed.');
    const screenshot=output+'/view-'+String(index+1).padStart(2,'0')+'.png';await canvas.screenshot({path:screenshot});
    results.push({view:index+1,title:book.scenes[index].title,source_object:annotation.spec.source_object,source_record_signature:annotation.signature,capture:screenshot});
    if(index===1){
      const pixels=await canvas.screenshot();
      await page.getByRole('button',{name:'Full model view',exact:true}).click();
      await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();
      assert(pixels.equals(await canvas.screenshot()),'Source annotation scene did not restore identical pixels.');
      const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();
      await(await event).saveAs(output+'/source-scene.json');
      await page.getByRole('button',{name:'Full model view',exact:true}).click();
      await page.getByLabel('Import model scene file',{exact:true}).setInputFiles(output+'/source-scene.json');await ready();
      assert(pixels.equals(await canvas.screenshot()),'Portable source annotation scene did not restore identical pixels.');
      const image=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();
      await(await image).saveAs(output+'/source-teaching-export.zip');
    }
  }
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export notebook',exact:true}).click();
  await(await event).saveAs(output+'/source-notebook.json');
  await page.getByRole('button',{name:'Edit notebook',exact:true}).click();
  await page.getByLabel('Import model notebook file',{exact:true}).setInputFiles(output+'/source-notebook.json');
  await page.getByRole('button',{name:'Save notebook',exact:true}).click();
  await page.getByRole('button',{name:'Present notebook',exact:true}).click();await ready();
  await page.getByRole('button',{name:'Save scene',exact:true}).click();
  const restored=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),storageKey);
  assert(JSON.stringify(restored.state.annotations)===JSON.stringify(book.scenes[0].scene.state.annotations),'Notebook import changed the original annotation.');
  await page.screenshot({path:output+'/workspace.png',fullPage:false});
  page.off('pageerror',onError);await page.unroute('**/*');
  assert(!errors.length&&!external.length,errors.concat(external).join('\n'));
  return {status:'passed',notebook_key:key,output,views:results.length,source_annotations:new Set(results.map(item=>item.source_object)).size,
    checks:['Exact native author endpoints and original bone context','Whole-bone and focused views','Pixel-identical save/restore and export/import','Source evidence retained in recaptured scenes','Credited teaching image export','Notebook export/import with original source records','Offline requests only'],results,page_errors:errors,external_requests:external};
}
