async page => {
  const notebook = new URL(page.url()).searchParams.get('acceptance-notebook');
  const runTag = new URL(page.url()).searchParams.get('acceptance-output') ?? '';
  if (runTag && !/^[a-z0-9-]{1,48}$/.test(runTag)) throw new Error('Use a short filename-safe acceptance output tag.');
  const suffix = runTag ? '-' + runTag : '';
  if (!notebook) throw new Error('Provide the prepared MIDA cutaway notebook using ?acceptance-notebook=<local-file>.');
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  const ready=async()=>{await page.waitForFunction(()=>/^(Ready|Notebook scene restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:90000});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  await page.reload();await ready();await page.getByRole('button',{name:'Learn',exact:true}).click();
  await page.locator('.teaching-notebook summary').click();
  await page.getByLabel('Import teaching notebook file').setInputFiles(notebook);
  await page.getByRole('button',{name:'Present notebook',exact:true}).click();await ready();
  const views=[];
  for(let i=0;i<4;i++){
    await ready();const title=await page.locator('.notebook-presentation h3').last().textContent();
    const point=await Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
    if(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue())!==1)throw new Error('Full source sections were lost.');
    const cut=await page.locator('.cutaway-active').count();if(!!cut!==[false,true,true,false][i])throw new Error('Prepared cutaway state was not applied or cleared.');
    await page.screenshot({path:'output/playwright/skull-cutaway-teaching-'+(i+1)+suffix+'.png'});
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();const path='data/exports/mida/skull-cutaway-teaching'+suffix+'/view-'+(i+1)+'.zip';await(await download).saveAs(path);
    views.push({title,position_ras_mm:point,cutaway:!!cut,export:path.replace(/^data\//,'')});
    if(i<3)await page.getByRole('button',{name:'Next view',exact:true}).click();
  }
  if(errors.length)throw new Error(errors.join('\n'));return{status:'passed',views,page_errors:errors};
}
