async page => {
  const errors = [], external = [];
  page.on('pageerror', error => errors.push(String(error)));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  // Inspect actual uploaded line coordinates and draw matrices, independently
  // of React or the application's scene/viewer objects. No application hooks.
  await page.addInitScript(() => {
    const probe = window.__trajectoryProbe = {armed:false, geometries:[], draws:[], ids:new WeakMap()};
    const locations = new WeakMap(), matrices = new WeakMap(), alphas = new WeakMap();
    const api = WebGL2RenderingContext.prototype;
    const get = api.getUniformLocation, matrix = api.uniformMatrix4fv, scalar = api.uniform1f, draw = api.drawElements;
    api.getUniformLocation = function(program, name) { const location = get.call(this, program, name); if (location) locations.set(location,{program,name}); return location; };
    api.uniformMatrix4fv = function(location, transpose, values) { const info=location&&locations.get(location); if(info?.name==='mvpMtx')matrices.set(info.program,Array.from(values)); return matrix.call(this,location,transpose,values); };
    api.uniform1f = function(location, value) { const info=location&&locations.get(location); if(info?.name==='opacity')alphas.set(info.program,value); return scalar.call(this,location,value); };
    api.drawElements = function(mode, count, type, offset) {
      const result=draw.call(this,mode,count,type,offset);
      if(!probe.armed || mode!==this.LINE_STRIP || type!==this.UNSIGNED_INT || this.getVertexAttrib(0,this.VERTEX_ATTRIB_ARRAY_STRIDE)!==16)return result;
      const buffer=this.getVertexAttrib(0,this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING), program=this.getParameter(this.CURRENT_PROGRAM);
      if(!buffer || !matrices.has(program))return result;
      let id=probe.ids.get(buffer);
      if(id===undefined){
        id=probe.geometries.length; probe.ids.set(buffer,id);
        const saved=this.getParameter(this.ARRAY_BUFFER_BINDING); this.bindBuffer(this.ARRAY_BUFFER,buffer);
        const vertices=new Float32Array(this.getBufferParameter(this.ARRAY_BUFFER,this.BUFFER_SIZE)/4); this.getBufferSubData(this.ARRAY_BUFFER,0,vertices); this.bindBuffer(this.ARRAY_BUFFER,saved);
        const indices=new Uint32Array(count); this.getBufferSubData(this.ELEMENT_ARRAY_BUFFER,offset,indices);
        probe.geometries.push({vertices,indices});
      }
      probe.draws.push({geometry:id,count,viewport:Array.from(this.getParameter(this.VIEWPORT)),matrix:matrices.get(program),opacity:alphas.get(program)});
      return result;
    };
  });
  const ready = async () => {
    await page.waitForFunction(() => /^(Ready|Scene saved|Saved scene restored|Scene file restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent ?? ''), null, {timeout:60000});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  await page.setViewportSize({width:1600,height:1050}); await page.reload(); await ready();
  const {atlas,manifest} = await page.evaluate(async()=>{
    const api=await(await fetch('/api/atlases')).json(), atlas=api.atlases.find(a=>a.dataset_id==='hcp1065_tracts');
    if(!atlas)throw new Error('Serve the HCP1065 source streamline package.');
    return {atlas,manifest:await(await fetch(atlas.manifest_url)).json()};
  });
  await page.getByLabel('Local atlas',{exact:true}).selectOption(atlas.key); await ready();
  const canvas=page.locator('canvas');
  const shot=async name=>{await page.locator('.workspace-heading h1').click();await ready();await canvas.screenshot({path:'output/playwright/streamlines-'+name+'.png'});};
  const captureDraws=async()=>{
    await page.evaluate(()=>{const p=window.__trajectoryProbe;p.armed=true;p.geometries=[];p.draws=[];p.ids=new WeakMap();window.dispatchEvent(new Event('resize'));});
    await ready();
    return page.evaluate(async()=>{
      const p=window.__trajectoryProbe;p.armed=false;
      const geometries=[];
      for(const {vertices,indices} of p.geometries){
        const points=vertices.length/4, lengths=[];let length=0,next=0,ordered=true;
        for(const index of indices){if(index===0xffffffff){lengths.push(length);length=0;}else{if(index!==next++)ordered=false;length++;}}
        if(length || next!==points)ordered=false;
        const canonical=new ArrayBuffer(points*12+lengths.length*4), bytes=new DataView(canonical);
        let cursor=0,point=0;
        for(const size of lengths){bytes.setUint32(cursor,size,true);cursor+=4;for(let i=0;i<size;i++,point++)for(let axis=0;axis<3;axis++){bytes.setFloat32(cursor,vertices[point*4+axis],true);cursor+=4;}}
        const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',canonical))).map(v=>v.toString(16).padStart(2,'0')).join('');
        const colors=new Uint8Array(vertices.buffer);
        let fixed=true;for(let i=1;i<points;i++)for(let axis=0;axis<3;axis++)if(colors[i*16+12+axis]!==colors[12+axis])fixed=false;
        geometries.push({point_count:points,streamline_count:lengths.length,index_count:indices.length,index_order_complete:ordered,coordinate_sha256:digest,
          first_point:Array.from(vertices.slice(0,3)),last_point:Array.from(vertices.slice(-4,-1)),color:Array.from(colors.slice(12,15)),fixed_color:fixed});
      }
      const canvas=document.querySelector('canvas'),box=canvas.getBoundingClientRect();
      return {geometries,draws:[...new Map(p.draws.map(d=>[JSON.stringify(d),d])).values()],canvas:[canvas.width,canvas.height],css:[box.width,box.height]};
    });
  };
  // Derive pointer locations from the observed GPU projection so layout height
  // changes cannot turn a source-picking check into an unrelated blank click.
  const projectedPick=async section=>{
    const screenshot=section?null:(await canvas.screenshot()).toString('base64');
    return page.evaluate(async({section,screenshot})=>{
    const probe=window.__trajectoryProbe,canvas=document.querySelector('canvas'),box=canvas.getBoundingClientRect();
    const draw=probe.draws.find(d=>{
      const scale=Math.hypot(d.matrix[2],d.matrix[6],d.matrix[10]);
      return section ? Math.abs(scale-2)<1e-5&&Math.abs(d.matrix[10])>1.9 : Math.abs(scale-2)>1e-5;
    });
    if(!draw)throw new Error('No observed projection for the pointer fixture.');
    const {vertices,indices}=probe.geometries[draw.geometry],m=draw.matrix,v=draw.viewport;
    if(!section){
      // Pick an actually visible bundle pixel. A projected source segment can
      // be covered by the orientation crosshair and is then not a valid hit.
      // Use the composited screenshot: the renderer deliberately releases its
      // drawing buffer after presentation, so a later canvas read is empty.
      const png=new Blob([Uint8Array.from(atob(screenshot),character=>character.charCodeAt(0))],{type:'image/png'});
      const bitmap=await createImageBitmap(png),surface=new OffscreenCanvas(bitmap.width,bitmap.height),context=surface.getContext('2d');
      context.drawImage(bitmap,0,0);bitmap.close();
      const pixels=context.getImageData(0,0,surface.width,surface.height).data;
      const color=Array.from(new Uint8Array(vertices.buffer).slice(12,15));
      const matches=(x,y)=>color.every((value,axis)=>Math.abs(pixels[(y*surface.width+x)*4+axis]-value)<=1);
      let best=null;
      for(let y=2;y<surface.height-2;y++)for(let x=2;x<surface.width-2;x++){
        if(!matches(x,y))continue;
        let neighbors=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(matches(x+dx,y+dy))neighbors++;
        if(neighbors<8)continue;
        const score=(x-surface.width/2)**2+(y-surface.height/2)**2;
        if(!best||score<best.score)best={score,x:(x+.5)*box.width/surface.width,y:(y+.5)*box.height/surface.height};
      }
      if(!best)throw new Error('No unoccluded source-colored interior pixel for the 3D pointer fixture.');
      return {x:best.x,y:best.y};
    }
    const clip=point=>[0,1,2,3].map(row=>point.reduce((sum,value,column)=>sum+m[column*4+row]*value,0));
    let previous=null,best=null;
    for(const index of indices){
      if(index===0xffffffff){previous=null;continue;}
      const current=[vertices[index*4],vertices[index*4+1],vertices[index*4+2],1];
      if(previous){
        const a=clip(previous),b=clip(current);let low=0,high=1;
        if(section){
          const delta=b[2]-a[2];
          if(Math.abs(delta)<1e-12){if(Math.abs(a[2])>1){previous=current;continue;}}
          else{const t0=(-1-a[2])/delta,t1=(1-a[2])/delta;low=Math.max(0,Math.min(t0,t1));high=Math.min(1,Math.max(t0,t1));}
          if(low>high){previous=current;continue;}
        }
        const t=(low+high)/2,p=a.map((value,i)=>value+t*(b[i]-value)),ndc=p.slice(0,3).map(value=>value/p[3]);
        if(Math.abs(ndc[0])<.9&&Math.abs(ndc[1])<.9&&Math.abs(ndc[2])<=1){
          const score=section?ndc[0]**2+ndc[1]**2:ndc[2];
          if(!best||score<best.score)best={score,x:(v[0]+(ndc[0]+1)*v[2]/2)*box.width/canvas.width,y:(canvas.height-v[1]-(ndc[1]+1)*v[3]/2)*box.height/canvas.height};
        }
      }
      previous=current;
    }
    if(!best)throw new Error('No visible original source segment for the pointer fixture.');
    return {x:best.x,y:best.y};
    },{section,screenshot});
  };
  const fixtures=[];
  for(const structure of manifest.structures){
    await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();
    await page.locator('button[title="'+structure.id+'"]').click();await ready();
    await page.getByRole('button',{name:'Isolate selected',exact:true}).click();await ready();
    const recorded=await captureDraws();
    assert(recorded.geometries.length===1,'Hidden source bundles entered the draw pass.');
    const expected=structure.streamlines.levels.find(l=>l.id==='standard'), geometry=recorded.geometries[0];
    assert(geometry.streamline_count===expected.streamline_count && geometry.point_count===expected.point_count && geometry.index_order_complete,'The GPU omitted or reordered a source trajectory.');
    assert(geometry.fixed_color && geometry.color.every((v,i)=>v===structure.color[i]),'The renderer changed bundle colors or added random dither.');
    await shot(structure.source_name);
    const coordinates=await Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
    assert(coordinates.every((v,i)=>Math.abs(v-structure.target_ras_mm[i])<.011),'Bundle selection moved away from its retained source target.');
    fixtures.push({id:structure.id,source_name:structure.source_name,position_ras_mm:structure.target_ras_mm,level:'standard',...recorded});
  }
  // Exercise visibility with several already-loaded bundles, then isolate one.
  await page.getByRole('button',{name:'Show matches',exact:true}).click();await ready();await shot('all-visible');
  const all=await captureDraws();assert(all.geometries.length===6,'Not all visible bundles reached the draw pass.');
  assert((await page.getByLabel('Displayed streamline count').textContent()).includes('6,144 displayed / 80,466 retained'),'The UI confuses display counts with retained source counts.');
  const readLocation=async()=>({position:await Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number))),selected:await page.locator('.coordinate-status').textContent()});
  // This source vertex is present in both CC and CST_L standard subsets.
  // Coincident estimates must remain separate selectable bundles.
  for(const [axis,value] of [['R',-25.71875],['A',-13.5],['S',40.375]])await page.getByLabel(axis+' coordinate in millimeters').fill(String(value));
  await ready();await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  const overlap=await page.evaluate(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)).state,atlas.key);
  assert(['hcp1065_tracts:bundle:CC','hcp1065_tracts:bundle:CST_L'].every(id=>overlap.selectionEvidence.candidates.includes(id)),'Overlapping source bundles were collapsed to one label.');
  await page.getByRole('button',{name:'Corpus callosum',exact:true}).click();await ready();
  assert((await readLocation()).position.every((v,i)=>Math.abs(v-overlap.position[i])<.011),'Choosing an overlap candidate moved the physical cursor.');
  await page.getByLabel('Show Left corticospinal tract',{exact:true}).uncheck();await ready();
  await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  const afterHide=await page.evaluate(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)).state,atlas.key);
  assert(!afterHide.selectionEvidence.candidates.includes('hcp1065_tracts:bundle:CST_L'),'Hiding a bundle left stale overlap selection evidence.');
  await page.locator('button[title="hcp1065_tracts:bundle:AF_L"]').click();await ready();
  await page.getByRole('button',{name:'Isolate selected',exact:true}).click();await ready();await shot('isolated');
  assert((await captureDraws()).geometries.length===1,'Hidden bundles remained visible after isolation.');
  await page.locator('canvas').click({position:await projectedPick(true)});await ready();
  const slicePick=await readLocation();assert(slicePick.selected==='Left arcuate fasciculus','The 2D source segment was not selected.');
  await page.getByLabel('View layout').selectOption('3d');await ready();
  const renderForPick=await captureDraws();
  await page.locator('canvas').dblclick({position:await projectedPick(false)});await ready();
  const renderPick=await readLocation();assert(renderPick.selected==='Left arcuate fasciculus','The visible 3D source trajectory was not selected.');
  assert(renderPick.position.some((v,i)=>Math.abs(v-slicePick.position[i])>1),'3D picking did not move the physical cursor.');
  await page.getByLabel('View layout').selectOption('quad');await ready();
  await page.locator('button[title="hcp1065_tracts:bundle:AF_L"]').click();await ready();
  // 3D-only opacity must not change MRI or 2D source section intersections.
  await page.getByLabel('View layout').selectOption('axial');await ready();await shot('slice-opaque');
  await page.getByLabel('3D trajectory opacity',{exact:true}).press('Home');await ready();await shot('slice-3d-hidden');
  await page.getByLabel('Streamline section opacity',{exact:true}).press('Home');await ready();await shot('slice-mri-only');
  await page.getByLabel('Streamline section opacity',{exact:true}).press('End');
  await page.getByLabel('3D trajectory opacity',{exact:true}).press('End');await ready();
  await page.getByLabel('Streamline section slab in millimeters').fill('3');await ready();await shot('slice-thick');
  await page.getByLabel('Radiological',{exact:true}).uncheck();await ready();await shot('slice-neurological');
  const neurological=await captureDraws();
  await page.getByLabel('Radiological',{exact:true}).check();
  await page.getByLabel('View layout').selectOption('quad');
  await page.getByLabel('Streamline display sampling').selectOption('detail');await ready();
  const detail=await captureDraws();
  const expectedDetail=manifest.structures[0].streamlines.levels.find(l=>l.id==='detail');
  assert(detail.geometries[0].streamline_count===expectedDetail.streamline_count,'Detail selection did not change the loaded source subset.');
  await page.getByLabel('Scene teaching notes').fill('Source-preserving streamline scene: display sampling, 3 mm slab and exact target.');
  await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();await shot('saved');
  const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)),atlas.key);
  assert(saved.state.streamlineLevel==='detail' && saved.state.streamlineSlabMm===3,'Saved scene lost trajectory settings.');
  const output='data/exports/hcp1065_tracts/browser-validation';
  let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs(output+'/streamline-scene.json');
  download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await download).saveAs(output+'/streamline-teaching.zip');await ready();
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();
  await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();await shot('restored');
  await page.reload();await ready();
  await page.getByLabel('Local atlas',{exact:true}).selectOption(atlas.key);await ready();
  await page.getByLabel('Import scene file',{exact:true}).setInputFiles(output+'/streamline-scene.json');await ready();await shot('imported');
  assert(await page.getByRole('alert').count()===0,'Portable scene import was rejected.');
  const graphics=await page.evaluate(()=>{const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError()};});
  assert(!errors.length,errors.join('\n'));assert(!external.length,'External requests in an offline fixture.');assert(graphics.error===0,'WebGL error');
  return {status:'passed',package_version:manifest.package_version,fixtures,neurological,detail,picking:{slice:slicePick,render:renderPick,render_matrices:renderForPick,overlap:{position:overlap.position,candidates:overlap.selectionEvidence.candidates,after_hide:afterHide.selectionEvidence.candidates}},graphics,page_errors:errors,external_requests:external,
    checks:['exact GPU source vertices and complete line indices','all six bundles in the shared reference','hidden bundle exclusion','independent 2D and 3D opacity','physical slab and orientation controls','saved and portable scene restoration','credited export'],independent_pixel_and_source_check_required:true};
}
