async page => {
  const assert=(value,message)=>{if(!value)throw Error(message)},checks=[],errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  const inspect=async label=>{
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const result=await page.evaluate(()=>{
      const scrollers=[...document.querySelectorAll('body *')].filter(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return b.width>0&&b.height>0&&(/auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+2)}).map(e=>e.tagName+'.'+e.className);
      const clipped=[...document.querySelectorAll('.complete-select-label,.compact-selection,.coordinate-status,h1,h2,h3')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0&&(e.scrollWidth>e.clientWidth+2||e.scrollHeight>e.clientHeight+2)}).map(e=>e.className||e.tagName);
      return {clipped_text:clipped,width:innerWidth,document_width:document.documentElement.clientWidth,scroll_width:document.documentElement.scrollWidth,nested_scrollers:scrollers};
    });
    assert(!result.clipped_text.length&&!result.nested_scrollers.length&&result.scroll_width<=result.document_width+1,label+': '+JSON.stringify(result)); checks.push({label,...result});
  };
  const ready=async()=>page.waitForFunction(()=>document.querySelector('.live-status')?.textContent?.startsWith('Ready')||document.querySelector('.model-status')?.textContent?.startsWith('Ready'),null,{timeout:90000});
  for(const width of [1600,1100,800,390]){
    await page.setViewportSize({width,height:1000});await ready();
    await inspect('ordinary');
    const model=await page.locator('.model-workspace').count();
    for(const name of ['Structure library',model?'Notes, lessons and sources':'Learning tools']){
      await page.getByRole('button',{name,exact:true}).click();await ready();await inspect(name);
      if(model)await page.locator(name==='Structure library'?'.model-library':'.model-tools').getByRole('button',{name:'Close',exact:true}).click();
      else await page.getByRole('button',{name:name==='Structure library'?'Close structure library':'Close learning tools',exact:true}).click();
    }
    if(!model){await page.getByRole('button',{name:'Expand viewer',exact:true}).click();await ready();await inspect('expanded');await page.getByRole('button',{name:'Exit expanded view',exact:true}).click();}
  }
  await page.setViewportSize({width:1600,height:1050});assert(!errors.length,errors.join('\n'));
  return {status:'passed',checks,page_errors:errors};
}
