async page => {
  // Pixel positions below were inspected in the real 1600 x 1050 workspace.
  // This checks actual pointer paths; it does not call renderer internals.
  await page.setViewportSize({width:1600,height:1050});
  await page.reload();
  const ready = () => page.waitForFunction(() => !document.querySelector('button.primary')?.disabled && document.querySelector('.live-status')?.textContent?.startsWith('Ready'), null, {timeout:45000});
  const read = async () => ({position:await Promise.all(['R','A','S'].map(axis => page.getByRole('spinbutton',{name:axis+' coordinate in millimeters'}).inputValue().then(Number))),selected:await page.locator('.coordinate-status').textContent()});
  const catalog = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases);
  const atlas = catalog.find(a => a.dataset_id==='spl_nac');
  if (!atlas) throw new Error('The inspected pointer fixture requires the SPL/NAC package.');
  await page.getByRole('combobox',{name:'Local atlas',exact:true}).selectOption(atlas.key);
  await ready();
  await page.getByRole('searchbox',{name:'Search structures'}).fill('left putamen');
  await page.getByRole('button',{name:'Left putamen left · Deep structures',exact:true}).click();
  await page.getByRole('button',{name:'Isolate selected',exact:true}).click();
  await page.getByRole('combobox',{name:'View layout'}).selectOption('3d');
  await ready();
  const before = await read();
  await page.locator('canvas').dblclick({position:{x:531,y:317}});
  await ready();
  const surface = await read();
  if (surface.selected!=='Left putamen' || surface.position.every((v,i)=>Math.abs(v-before.position[i])<.5)) throw new Error('Visible surface picking did not move to the chosen structure boundary.');
  await page.getByRole('combobox',{name:'View layout'}).selectOption('quad');
  await ready();
  await page.screenshot({path:'output/playwright/surface-to-slices-validated.png'});
  await page.locator('canvas').click({position:{x:363,y:151}});
  await ready();
  const slice = await read();
  if (slice.selected!=='Left putamen') throw new Error('The inspected source-labelled slice point was not selected.');
  await page.getByRole('combobox',{name:'View layout'}).selectOption('axial');
  await ready();
  await page.locator('canvas').screenshot({path:'output/playwright/mri-slice-surface-visible.png'});
  await page.getByRole('slider',{name:'Surface opacity',exact:true}).press('Home');
  await ready();
  await page.locator('canvas').screenshot({path:'output/playwright/mri-slice-surface-hidden.png'});
  await page.getByRole('slider',{name:'Label opacity',exact:true}).press('Home');
  await ready();
  await page.locator('canvas').screenshot({path:'output/playwright/mri-slice-no-label.png'});
  await page.getByRole('spinbutton',{name:'R coordinate in millimeters'}).fill('300');
  await page.waitForFunction(()=>document.querySelector('.coordinate-status')?.textContent==='No source label at cursor');
  const outside = await read();
  return {status:'passed',origin:new URL(page.url()).origin,package_version:atlas.package_version,before,surface,slice,outside,independent_voxel_check_required:true};
}
