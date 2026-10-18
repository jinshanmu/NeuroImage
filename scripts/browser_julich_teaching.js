async page => {
  const origin = new URL(page.url()).origin, errors = [], external = [], verified = [];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const onError = error => errors.push(String(error));
  page.on('pageerror', onError); await page.unroute('**/*');
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (external.push(route.request().url()), route.abort()));
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Notebook scene restored|Teaching export prepared|Scene saved|Saved scene restored|Scene file restored)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:120000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert(!await page.locator('.error[role=alert]').count(), 'The image viewer reported an error.');
  };
  const library = await (await page.request.get(origin + '/api/workspace/teaching?dataset=julich_selected')).json();
  const curricula = ['julich-central-cortex','julich-medial-temporal','julich-cerebellar-nuclei','julich-deep-regions'];
  for (const id of curricula) {
    const record = library.records.find(item => item.relative_path.includes('/' + id + '-'));
    assert(record, 'Missing prepared curriculum: ' + id);
    const content = (await (await page.request.get(origin + '/api/workspace/teaching/' + record.key)).json()).content;
    await page.goto(origin);
    await page.getByRole('button',{name:'Teaching library',exact:true}).click();
    await page.getByRole('searchbox',{name:'Search teaching library',exact:true}).fill(record.title);
    await page.getByRole('article',{name:record.title,exact:true}).getByRole('button',{name:'Open notebook',exact:true}).click();
    await ready();
    const atlasKey = await page.getByRole('combobox',{name:'Source',exact:true}).inputValue();
    const api = await (await page.request.get(origin + '/api/atlases')).json();
    const atlas = api.atlases.find(item => item.key === atlasKey);
    const manifest = await (await page.request.get(origin + atlas.manifest_url)).json();
    assert(manifest.structures.length === 314 && manifest.volumes.filter(item => item.kind === 'image').length === 2, 'The complete source MPM and references were not opened.');
    const output = 'data/benchmarks/julich_selected/integration-browser/' + id;
    for (let index = 0; index < content.scenes.length; index++) {
      if (index) {await page.getByRole('button',{name:'Next view',exact:true}).click();await ready();}
      const expected = content.scenes[index].scene;
      await page.getByRole('button',{name:'Save scene',exact:true}).click();
      const saved = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),'neuroimage:scene:' + atlasKey);
      for (const field of ['selected','position','visible','background','radiological','pan','surfaceOpacity']) assert(JSON.stringify(saved.state[field]) === JSON.stringify(expected.state[field]), id + ': changed ' + field);
      const structure = manifest.structures.find(item=>item.id===saved.state.selected);
      assert(structure && Math.sign(saved.state.position[0]) === (structure.laterality === 'left' ? -1 : 1), 'Source target laterality changed.');
      verified.push({curriculum:id,view:index+1,structure:structure.name,source_value:structure.label_value,position_ras_mm:saved.state.position});
      if (index === 0) {
        const canvas = page.locator('.canvas-shell canvas');
        await canvas.screenshot({path:output + '/full-sections.png'});
        const pixels = await canvas.screenshot();
        await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();
        assert(Number(await page.getByLabel('2D zoom',{exact:true}).inputValue()) > 1,'Cursor magnification was not applied.');
        const coords=await Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
        assert(coords.every((value,axis)=>Math.abs(value-saved.state.position[axis])<.011),'Magnifying changed the physical point.');
        await canvas.screenshot({path:output + '/same-point-magnified.png'});
        let event=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await event).saveAs(output + '/magnified-teaching.zip');
        await page.getByRole('checkbox',{name:'Radiological',exact:true}).uncheck();await ready();
        await page.getByRole('button',{name:'Return to recorded view',exact:true}).click();await ready();
        assert(pixels.equals(await canvas.screenshot()),'Source view restoration changed rendered pixels.');
        event=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await event).saveAs(output + '/full-teaching.zip');
        await page.screenshot({path:output + '/workspace.png'});
      }
    }
    const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export notebook',exact:true}).click();await(await event).saveAs(output + '/notebook.json');
    await page.getByLabel('Import teaching notebook file',{exact:true}).setInputFiles(output + '/notebook.json');
    await page.getByRole('button',{name:'Present notebook',exact:true}).click();await ready();
  }
  page.off('pageerror',onError);await page.unroute('**/*');
  assert(!errors.length&&!external.length,errors.concat(external).join('\n'));
  return {status:'passed',curricula:curricula.length,verified_views:verified.length,verified,
    checks:['Complete original label inventory','Common teaching library opens MRI notebooks','Exact RAS points, selection and visibility','Explicit source hemisphere targets','Alternating original T1 and T2','Full sections and same-point magnification','Radiological convention restoration','Pixel-identical return to recorded scene','Credited image and portable notebook exports'],page_errors:errors,external_requests:external};
}
