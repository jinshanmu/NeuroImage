async page => {
  const notebook = new URL(page.url()).searchParams.get('acceptance-notebook');
  const runTag = new URL(page.url()).searchParams.get('acceptance-output') ?? '';
  if (runTag && !/^[a-z0-9-]{1,48}$/.test(runTag)) throw new Error('Use a short filename-safe acceptance output tag.');
  const suffix = runTag ? '-' + runTag : '';
  if (!notebook) throw new Error('Provide the prepared native MRA notebook using ?acceptance-notebook=<local-file>.');
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  const ready = async () => { await page.waitForFunction(() => /^(Ready|Notebook scene restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:60000}); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); };
  await page.reload(); await ready();
  await page.getByRole('button',{name:'Learn',exact:true}).click();
  await page.locator('.teaching-notebook summary').click();
  await page.getByLabel('Import teaching notebook file').setInputFiles(notebook);
  await page.getByRole('button',{name:'Present notebook',exact:true}).click(); await ready();
  const views = [], output = 'data/exports/ixi_mra/native-image-teaching' + suffix;
  const position = () => Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  const exportView = async name => { const pending=page.waitForEvent('download'); await page.getByRole('button',{name:'Export teaching image',exact:true}).click(); await(await pending).saveAs(output+'/'+name+'.zip'); };
  for (let index=0;index<4;index++) {
    await ready(); const point = await position(), title = await page.locator('.notebook-presentation h3').last().textContent();
    if (Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) !== 1) throw new Error('A native observation lost complete acquired sections.');
    const window = await Promise.all(['minimum','maximum'].map(name=>page.getByLabel('Image window '+name,{exact:true}).inputValue().then(Number)));
    const expected = index===1 ? [65,250] : [0,150];
    if (JSON.stringify(window)!==JSON.stringify(expected)) throw new Error('The recorded image contrast did not restore.');
    await page.screenshot({path:'output/playwright/native-mra-teaching-'+(index+1)+suffix+'.png'}); await exportView('view-'+(index+1));
    if (index===0) {
      await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click(); await ready();
      if (JSON.stringify(await position())!==JSON.stringify(point)) throw new Error('Magnification moved the recorded native source point.');
      await page.screenshot({path:'output/playwright/native-mra-teaching-1-magnified'+suffix+'.png'}); await exportView('view-1-magnified');
      await page.getByRole('button',{name:'Return to recorded view',exact:true}).click(); await ready();
    }
    views.push({title,position_ras_mm:point,window,export:output.replace(/^data\//,'')+'/view-'+(index+1)+'.zip'});
    if (index<3) await page.getByRole('button',{name:'Next view',exact:true}).click();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return {status:'passed',views,page_errors:errors};
}
