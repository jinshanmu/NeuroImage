async page => {
  // Development-branch reference: requires the retained scene/import/export footer.
  // This historical workflow is not a formal-release acceptance script.
  const errors = [], external = [], origin = new URL(page.url()).origin;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  // Observe native WebGL draw uniforms and buffer revisions, without application
  // or renderer object access. Source vertices must never be rewritten by a cut.
  await page.addInitScript(() => {
    const api = WebGL2RenderingContext.prototype, locations = new WeakMap(), programs = new WeakMap();
    const ids = new WeakMap(), revisions = new WeakMap(), bound = new Map(); let sequence = 0;
    const probe = window.__surfaceCutawayProbe = {armed:false, draws:[], samples:[]};
    const locate = api.getUniformLocation, vector = api.uniform4fv, matrix = api.uniformMatrix4fv;
    const bind = api.bindBuffer, upload = api.bufferData, change = api.bufferSubData, draw = api.drawElements;
    const read = api.readPixels;
    api.readPixels = function(...args) {
      const result = read.apply(this, args);
      if (probe.armed && args[2] === 1 && args[3] === 1) probe.samples.push({x:args[0],y:args[1],rgba:Array.from(args[6]),viewport:Array.from(this.getParameter(this.VIEWPORT)),dither:this.isEnabled(this.DITHER)});
      return result;
    };
    api.getUniformLocation = function(program, name) {
      const location = locate.call(this, program, name);
      if (!programs.has(program)) programs.set(program, {names:new Set(), plane:null, matrix:null});
      programs.get(program).names.add(name);
      if (location) locations.set(location, {program, name});
      return location;
    };
    api.uniform4fv = function(location, values, ...rest) {
      const info = location && locations.get(location);
      if (info?.name === 'neuroimageCutPlane') programs.get(info.program).plane = Array.from(values);
      return vector.call(this, location, values, ...rest);
    };
    api.uniformMatrix4fv = function(location, transpose, values) {
      const info = location && locations.get(location);
      if (info?.name === 'mvpMtx') programs.get(info.program).matrix = Array.from(values);
      return matrix.call(this, location, transpose, values);
    };
    api.bindBuffer = function(target, buffer) { bound.set(target, buffer); return bind.call(this, target, buffer); };
    const revision = target => { const buffer = bound.get(target); if (buffer) revisions.set(buffer, (revisions.get(buffer) ?? 0) + 1); };
    api.bufferData = function(target, ...args) { revision(target); return upload.call(this, target, ...args); };
    api.bufferSubData = function(target, ...args) { revision(target); return change.call(this, target, ...args); };
    api.drawElements = function(mode, count, type, offset) {
      const result = draw.call(this, mode, count, type, offset), program = this.getParameter(this.CURRENT_PROGRAM), info = programs.get(program);
      if (!probe.armed || mode !== this.TRIANGLES || !info?.names.has('normMtx') || !info.names.has('opacity')) return result;
      const buffer = this.getVertexAttrib(0, this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
      if (!buffer) return result;
      if (!ids.has(buffer)) ids.set(buffer, ++sequence);
      const fragments = this.getAttachedShaders(program).filter(shader => this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER);
      const fragment = this.getShaderSource(fragments[0]);
      probe.draws.push({buffer:ids.get(buffer), revision:revisions.get(buffer) ?? 0, count, plane:info.plane, matrix:info.matrix,
        viewport:Array.from(this.getParameter(this.VIEWPORT)), picking:fragment.includes('packFloatToVec4i'), blend:this.isEnabled(this.BLEND), depth_write:this.getParameter(this.DEPTH_WRITEMASK),
        native_fragment_cut:fragment.includes('dot(vec4(vP.xyz, 1.0), neuroimageCutPlane) > 0.0')});
      return result;
    };
  });
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Image export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:90000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await page.setViewportSize({width:1720,height:1200}); await page.reload(); await ready();
  const atlas = await page.evaluate(async () => (await (await fetch('/api/atlases')).json()).atlases.find(atlas => atlas.dataset_id === 'mida'));
  assert(atlas, 'Serve the expanded native MIDA source model.');
  await page.getByLabel('Local atlas', {exact:true}).selectOption(atlas.key); await ready();
  await page.getByRole('button', {name:'Reset view', exact:true}).click(); await ready();
  await page.locator('button[title="mida:label:40"]').click(); await ready();
  await page.getByRole('button', {name:'Isolate selected', exact:true}).click(); await ready();
  const coordinates = () => Promise.all(['R','A','S'].map(axis => page.getByLabel(axis + ' coordinate in millimeters').inputValue().then(Number)));
  const originalPoint = await coordinates(), canvas = page.locator('canvas');
  await page.locator('.surface-cutaway-controls summary').click();
  await page.getByRole('button', {name:'Cut visible surfaces at cursor', exact:true}).click(); await ready();
  const planeInput = page.getByLabel('Surface cutaway coordinate in millimeters');
  const records = [];
  const capture = async (name, expectedPlane) => {
    await ready();
    assert(JSON.stringify(await coordinates()) === JSON.stringify(originalPoint), 'A display cut changed the native physical cursor.');
    assert(Number(await page.getByLabel('2D zoom', {exact:true}).inputValue()) === 1, 'A display cut lost complete source sections.');
    await page.evaluate(() => { const probe = window.__surfaceCutawayProbe; probe.draws=[]; probe.armed=true; dispatchEvent(new Event('resize')); });
    await ready();
    const measured = await page.evaluate(() => {
      const probe = window.__surfaceCutawayProbe; probe.armed=false;
      return {draws:[...new Map(probe.draws.map(draw => [JSON.stringify(draw),draw])).values()], canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height]};
    });
    const clipped = measured.draws.filter(draw => draw.native_fragment_cut && !draw.picking);
    assert(clipped.length > 0 && clipped.every(draw => JSON.stringify(draw.plane) === JSON.stringify(expectedPlane)), 'The actual GPU plane differs from the native RAS control.');
    await canvas.screenshot({path:'output/playwright/surface-cutaway-' + name + '.png'});
    records.push({name, expected_plane:expectedPlane, ...measured});
  };
  await planeInput.fill('10000'); await capture('whole', [0,0,1,-10000]);
  await planeInput.fill('0'); await capture('superior', [0,0,1,0]);
  await page.getByLabel('Surface cutaway removed side').selectOption('-1'); await capture('inferior', [0,0,-1,0]);
  await page.getByLabel('Surface cutaway plane').selectOption('0'); await planeInput.fill('0');
  await page.getByLabel('Surface cutaway removed side').selectOption('1'); await capture('right', [1,0,0,0]);
  await page.getByLabel('Surface cutaway plane').selectOption('1'); await planeInput.fill('20'); await capture('anterior', [0,1,0,-20]);
  const key = 'neuroimage:scene:' + atlas.key, previous = await page.evaluate(key => localStorage.getItem(key), key);
  try {
    await page.getByRole('button', {name:'Save scene', exact:true}).click(); await ready();
    const scene = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert(scene.state.surfaceCutaway.structures.length === 1 && scene.state.surfaceCutaway.structures[0] === 'mida:label:40', 'Cutaway scope escaped its selected source surface.');
    await planeInput.fill('10000'); await ready();
    await page.getByRole('button', {name:'Restore saved', exact:true}).click(); await capture('restored', [0,1,0,-20]);
    const output = 'data/exports/mida/surface-cutaway-acceptance';
    const download = page.waitForEvent('download'); await page.getByRole('button', {name:'Export scene', exact:true}).click();
    await (await download).saveAs(output + '/scene.json');
    await page.getByRole('button', {name:'Restore whole surfaces', exact:true}).click(); await ready();
    await page.getByLabel('Import scene file').setInputFiles(output + '/scene.json'); await capture('imported', [0,1,0,-20]);
    const png = (await canvas.screenshot()).toString('base64'), viewport = records.at(-1).draws[0].viewport;
    const pointer = await page.evaluate(async ({png,viewport}) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), c => c.charCodeAt(0))], {type:'image/png'}));
      const surface = new OffscreenCanvas(bitmap.width, bitmap.height), context = surface.getContext('2d');
      context.drawImage(bitmap,0,0); bitmap.close();
      const pixels = context.getImageData(0,0,surface.width,surface.height).data;
      const [left,bottom,width,height] = viewport, top = surface.height - bottom - height;
      const isBone = (x,y) => { const i=(y*surface.width+x)*4, r=pixels[i],g=pixels[i+1],b=pixels[i+2]; return r>70&&g>70&&Math.abs(r-g)<10&&b<Math.min(r,g)-20; };
      let best=null;
      for (let y=top+3;y<top+height-3;y++) for (let x=left+3;x<left+width-3;x++) {
        if (!isBone(x,y)) continue;
        let interior=true; for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(!isBone(x+dx,y+dy))interior=false;
        if (!interior) continue;
        const distance=(x-left-width/2)**2+(y-top-height/2)**2;
        if (!best||distance<best.distance) best={x:x+.5,y:y+.5,distance};
      }
      if (!best) throw new Error('No unoccluded native skull pixel is available for picking.');
      const box=document.querySelector('canvas').getBoundingClientRect();
      return {x:box.x+best.x*box.width/surface.width,y:box.y+best.y*box.height/surface.height};
    }, {png,viewport});
    await page.evaluate(() => { const probe=window.__surfaceCutawayProbe;probe.draws=[];probe.armed=true; });
    await page.mouse.dblclick(pointer.x,pointer.y); await ready();
    const pickedPosition=await coordinates();
    const picking=await page.evaluate(() => {const probe=window.__surfaceCutawayProbe;probe.armed=false;return probe.draws.filter(draw=>draw.picking);});
    assert(picking.some(draw=>draw.native_fragment_cut&&JSON.stringify(draw.plane)==='[0,1,0,-20]'), 'Depth picking did not use the same native clipping plane.');
    assert(picking.every(draw=>!draw.blend&&draw.depth_write), 'Surface depth data were alpha blended.');
    assert(pickedPosition[1]<=20.02 && JSON.stringify(pickedPosition)!==JSON.stringify(originalPoint), 'Picking selected the hidden half-space or failed to locate a visible source surface.');
    await page.getByLabel('Import scene file').setInputFiles(output + '/scene.json'); await capture('after-picking-restore', [0,1,0,-20]);
    await page.getByLabel('Surface opacity', {exact:true}).press('Home');
    await page.getByLabel('Surface opacity', {exact:true}).press('ArrowRight'); await ready();
    await page.evaluate(() => { const probe=window.__surfaceCutawayProbe;probe.draws=[];probe.armed=true; });
    await page.mouse.dblclick(pointer.x,pointer.y); await ready();
    const translucentPosition=await coordinates();
    const translucentPicking=await page.evaluate(() => { const probe=window.__surfaceCutawayProbe;probe.armed=false;return probe.draws.filter(draw=>draw.picking); });
    assert(translucentPicking.length>0&&translucentPicking.every(draw=>!draw.blend&&draw.depth_write), 'Translucent geometry corrupted packed depth.');
    assert(translucentPosition.every((value,axis)=>Math.abs(value-pickedPosition[axis])<.011), 'Opacity changed the picked physical surface position.');
    await page.getByLabel('Surface opacity', {exact:true}).press('Home'); await ready();
    await page.evaluate(() => {const probe=window.__surfaceCutawayProbe;probe.draws=[];probe.armed=true;});
    await page.mouse.dblclick(pointer.x,pointer.y); await ready();
    const hiddenPicking=await page.evaluate(() => {const probe=window.__surfaceCutawayProbe;probe.armed=false;return probe.draws.filter(draw=>draw.picking);});
    assert(hiddenPicking.length===0 && (await coordinates()).every((value,axis)=>Math.abs(value-translucentPosition[axis])<.011), 'An invisible zero-opacity surface entered depth picking.');
    await page.getByLabel('Import scene file').setInputFiles(output + '/scene.json'); await ready();
    await page.getByLabel('Show Pons', {exact:true}).check(); await capture('context', [0,1,0,-20]);
    assert(records.at(-1).draws.some(draw=>!draw.native_fragment_cut), 'A non-target source surface was also clipped.');
    await page.getByLabel('Import scene file').setInputFiles(output + '/scene.json'); await ready();
    const teaching = page.waitForEvent('download'); await page.getByRole('button', {name:'Export image', exact:true}).click();
    await (await teaching).saveAs(output + '/teaching-image.zip');
    await page.screenshot({path:'output/playwright/surface-cutaway-controls.png'});
    assert(!errors.length && !external.length, 'The native cutaway workflow had page errors or external requests.');
    return {status:'passed', package_version:atlas.package_version ?? atlas.key.slice(-16), source_structure:'mida:label:40', position_ras_mm:originalPoint,
      records, picking:{pointer,samples:await page.evaluate(()=>window.__surfaceCutawayProbe.samples),position_ras_mm:pickedPosition,draws:picking,translucent_position_ras_mm:translucentPosition,translucent_draws:translucentPicking,zero_opacity_draws:hiddenPicking}, scene:scene, export:output.replace(/^data\//,'') + '/teaching-image.zip', page_errors:errors, external_requests:external};
  } finally { await page.evaluate(({key,previous}) => previous === null ? localStorage.removeItem(key) : localStorage.setItem(key,previous), {key,previous}); }
}
