async page => {
  // Pixel positions below were inspected in the real 1600 x 1050 workspace.
  // This checks actual pointer paths; it does not call renderer internals.
  // These historical coordinates require a new browser run to validate the current layout.
  const origin = new URL(page.url()).origin;
  await page.setViewportSize({width:1600,height:1050});
  await page.reload();
  const ready = async () => {
    await page.waitForFunction(() => !!document.querySelector('.canvas-shell[data-ready="true"]') ||
      !!document.querySelector('[role=alert],.load-error'), null, {timeout:45000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (await page.locator('[role=alert],.load-error').count())
      throw new Error('A viewer error is visible: ' + (await page.locator('[role=alert],.load-error').allTextContents()).join(' · '));
    if (await page.locator('.canvas-shell[data-ready="true"]').count() !== 1)
      throw new Error('The source canvas did not become ready.');
  };
  const read = async () => {
    const readout = page.locator('.cursor-readout .coordinate-status');
    if (await readout.count() !== 1 || await page.locator('.coordinate-status').count() !== 1 ||
      await page.locator('.compact-selection').count() !== 0) throw new Error('The atlas must show one cursor name above the canvas.');
    const cursor_name = await readout.textContent();
    return {position:await Promise.all(['R','A','S'].map(axis => page.getByRole('spinbutton',{name:axis+' coordinate in millimeters'}).inputValue().then(Number))),cursor_name};
  };
  const catalog = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases);
  const atlas = catalog.find(a => a.dataset_id==='spl_nac');
  if (!atlas) throw new Error('The inspected pointer fixture requires the SPL/NAC package.');
  await page.goto(origin + '/?view=atlas&atlas=' + encodeURIComponent(atlas.key));
  await ready();
  const library = page.getByRole('region',{name:'Primary atlas workspace',exact:true}).getByRole('button',{name:'Structure library',exact:true});
  if (await library.count() && await library.getAttribute('aria-expanded') === 'false') await library.click();
  await page.getByRole('searchbox',{name:'Search structures'}).fill('left putamen');
  await page.getByRole('button',{name:'Left putamen',exact:true}).click();
  if (await library.getAttribute('aria-expanded') === 'false') await library.click();
  await page.getByRole('combobox',{name:'Anatomy category',exact:true}).selectOption('all');
  // A search narrows rows, never the selected batch target. Deselecting all
  // must therefore clear the entire source while this search is still active.
  await page.getByRole('button',{name:'Deselect',exact:true}).click();
  await ready();
  // Keep every source row mounted so the selected-row assertions below also
  // detect an unintended selection outside the earlier search results.
  await page.getByRole('searchbox',{name:'Search structures'}).fill('');
  await page.waitForFunction(count => document.querySelectorAll('.structure-row').length === count, atlas.structures);
  if (await page.locator('.structure-row input:checked').count()) throw new Error('Searching limited the all-source batch target.');
  await page.getByRole('checkbox',{name:'Show Left putamen',exact:true}).check();
  await ready();
  if (await page.locator('.structure-row input:checked').count() !== 1) throw new Error('The inspected source structure was not isolated by the visibility controls.');
  if (await page.locator('.structure-row.selected').count() !== 1 ||
    await page.locator('.structure-row.selected button').getAttribute('title') !== 'spl_nac:label:12')
    throw new Error('The inspected source structure was not uniquely selected before picking.');
  if (await library.getAttribute('aria-expanded') !== 'true') throw new Error('The structure library closed before its toggle was used.');
  await library.click();
  if (await library.getAttribute('aria-expanded') !== 'false') throw new Error('The structure library toggle did not close its sidebar.');
  const visible = () => page.getByRole('checkbox',{name:'Show Left putamen',exact:true,includeHidden:true}).isChecked();
  await page.getByRole('combobox',{name:'View layout'}).selectOption('3d');
  await ready();
  const before = await read();
  await page.locator('canvas').dblclick({position:{x:531,y:317}});
  await ready();
  const surface = await read();
  if (await visible() || surface.cursor_name!=='Left putamen' || surface.position.every((v,i)=>Math.abs(v-before.position[i])<.5)) throw new Error('Visible surface picking did not hide the structure while preserving its cursor name at the source boundary.');
  if (await page.locator('.structure-row.selected').count()) throw new Error('Hiding the surface left an active structure selection.');
  await page.getByRole('combobox',{name:'View layout'}).selectOption('quad');
  await ready();
  await page.screenshot({path:'output/playwright/surface-to-slices-validated.png'});
  await page.locator('canvas').click({position:{x:363,y:151}});
  await ready();
  const cursorOnly = await read();
  if (await visible() || cursorOnly.cursor_name!=='Left putamen') throw new Error('Single-clicking a hidden source lost its cursor name or changed structure visibility.');
  await page.locator('canvas').dblclick({position:{x:363,y:151}});
  await ready();
  const slice = await read();
  if (slice.cursor_name!=='Left putamen' || !await visible()) throw new Error('Double-clicking the inspected source-labelled slice point did not show the hidden structure.');
  await page.locator('canvas').dblclick({position:{x:363,y:151}});
  await ready();
  const deselected = await read();
  if (await visible() || deselected.cursor_name!=='Left putamen') throw new Error('Double-clicking the same source-labelled point did not hide the structure while retaining its cursor name.');
  if (await page.locator('.structure-row.selected').count()) throw new Error('Deselecting the 2D source left an active structure selection.');
  await page.locator('canvas').dblclick({position:{x:363,y:151}});
  await ready();
  const restored = await read();
  if (restored.cursor_name!=='Left putamen' || !await visible()) throw new Error('Double-clicking the same source-labelled point did not restore the hidden structure.');
  await page.getByRole('combobox',{name:'View layout'}).selectOption('axial');
  await ready();
  await page.locator('canvas').screenshot({path:'output/playwright/mri-slice-surface-visible.png'});
  await page.getByRole('slider',{name:'3D opacity',exact:true}).press('Home');
  await ready();
  await page.locator('canvas').screenshot({path:'output/playwright/mri-slice-surface-hidden.png'});
  await page.getByRole('slider',{name:'2D overlay',exact:true}).press('Home');
  await ready();
  await page.locator('canvas').screenshot({path:'output/playwright/mri-slice-no-label.png'});
  await page.getByRole('spinbutton',{name:'R coordinate in millimeters'}).fill('300');
  await page.waitForFunction(()=>document.querySelector('.cursor-readout .coordinate-status')?.textContent==='Background');
  const outside = await read();
  if (outside.cursor_name!=='Background') throw new Error('Moving the cursor outside the source labels did not report true background.');
  return {status:'passed',origin:new URL(page.url()).origin,package_version:atlas.package_version,before,surface,cursorOnly,slice,deselected,restored,outside,independent_voxel_check_required:true};
}
