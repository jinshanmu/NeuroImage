async page => {
  const errors = [], external = [], probes = [], geometries = [];
  page.on('pageerror', error => errors.push(String(error)));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const origin = new URL(page.url()).origin;
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  // Observe actual source mesh uploads and matrices, not application objects.
  await page.addInitScript(() => {
    const probe = window.__regionDraws = { armed:false, records:[], ids:new WeakMap() };
    const locations = new WeakMap(), matrices = new WeakMap();
    const api = WebGL2RenderingContext.prototype;
    const get = api.getUniformLocation, matrix = api.uniformMatrix4fv, draw = api.drawElements;
    api.getUniformLocation = function(program, name) { const result=get.call(this,program,name);if(result)locations.set(result,{program,name});return result; };
    api.uniformMatrix4fv = function(location, transpose, values) { const info=location&&locations.get(location);if(info?.name==='mvpMtx')matrices.set(info.program,Array.from(values));return matrix.call(this,location,transpose,values); };
    api.drawElements = function(mode,count,type,offset) {
      const result=draw.call(this,mode,count,type,offset), stride=this.getVertexAttrib(0,this.VERTEX_ATTRIB_ARRAY_STRIDE);
      if(!probe.armed || mode!==this.TRIANGLES || type!==this.UNSIGNED_INT || ![20,28].includes(stride) || this.getVertexAttrib(2,this.VERTEX_ATTRIB_ARRAY_TYPE)!==this.UNSIGNED_BYTE)return result;
      const buffer=this.getVertexAttrib(0,this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),program=this.getParameter(this.CURRENT_PROGRAM);
      if(!buffer || !matrices.has(program) || probe.ids.has(buffer))return result;
      probe.ids.set(buffer,true);
      const saved=this.getParameter(this.ARRAY_BUFFER_BINDING);this.bindBuffer(this.ARRAY_BUFFER,buffer);
      const raw=new Float32Array(this.getBufferParameter(this.ARRAY_BUFFER,this.BUFFER_SIZE)/4);this.getBufferSubData(this.ARRAY_BUFFER,0,raw);this.bindBuffer(this.ARRAY_BUFFER,saved);
      const points=new Float32Array(raw.length/(stride/4)*3);
      for(let i=0;i<points.length/3;i++)for(let j=0;j<3;j++)points[i*3+j]=raw[i*stride/4+j];
      const faces=new Uint32Array(count);this.getBufferSubData(this.ELEMENT_ARRAY_BUFFER,offset,faces);
      probe.records.push({points,faces,matrix:matrices.get(program),viewport:Array.from(this.getParameter(this.VIEWPORT))});
      return result;
    };
  });
  const ready = async () => {
    await page.waitForFunction(()=>/^(Ready|Scene saved|Saved scene restored|Scene file restored|Teaching export prepared)/.test(document.querySelector('.live-status')?.textContent??''),null,{timeout:60000});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  const position=()=>Promise.all(['R','A','S'].map(axis=>page.getByLabel(axis+' coordinate in millimeters').inputValue().then(Number)));
  const setPosition=async values=>{for(let i=0;i<3;i++)await page.getByLabel(['R','A','S'][i]+' coordinate in millimeters').fill(String(values[i]));await ready();};
  const shot=async name=>{await page.locator('.workspace-heading h1').click();await ready();await page.locator('canvas').screenshot({path:'output/playwright/regions-'+name+'.png'});};
  await page.setViewportSize({width:1600,height:1050});await page.reload();await ready();
  const {atlas,manifest,report}=await page.evaluate(async()=>{
    const catalog=await(await fetch('/api/atlases')).json(),atlas=catalog.atlases.find(a=>a.dataset_id==='brainstem_navigator_mni');
    if(!atlas)throw new Error('Serve the independent brainstem package.');
    const manifest=await(await fetch(atlas.manifest_url)).json();
    return {atlas,manifest,report:await(await fetch(atlas.base_url+manifest.validation.report)).json()};
  });
  await page.getByLabel('Local atlas',{exact:true}).selectOption(atlas.key);await ready();
  async function choose(structure) {
    await page.locator('button[title="'+structure.id+'"]').click();
    await page.waitForFunction(()=>/^\d\.\d{4}$/.test(document.querySelector('output[aria-label="Source probability at cursor"]')?.textContent??''),null,{timeout:60000});await ready();
  }
  async function sample(structure,test) {
    await ready();const value=Number(await page.getByLabel('Source probability at cursor').textContent());
    assert(Number.isFinite(value),'Source field is unavailable.');
    probes.push({structure_id:structure.id,test,position_ras_mm:await position(),displayed_support:value});
  }
  async function capture(structure) {
    await page.evaluate(()=>{const p=window.__regionDraws;p.records=[];p.ids=new WeakMap();p.armed=true;window.dispatchEvent(new Event('resize'));});await ready();
    return page.evaluate(async({expected,position})=>{
      const p=window.__regionDraws;p.armed=false;
      const matches=p.records.filter(record=>record.points.length/3===expected);
      if(matches.length!==1)throw new Error('Expected exactly one retained source mesh in the draw pass: '+matches.length);
      const record=matches[0],{points,faces,matrix,viewport}=record;
      const sha=async array=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',array.buffer))).map(n=>n.toString(16).padStart(2,'0')).join('');
      const canvas=document.querySelector('canvas'),box=canvas.getBoundingClientRect();
      function project(point){const v=[...point,1],clip=[0,1,2,3].map(row=>v.reduce((sum,value,column)=>sum+matrix[column*4+row]*value,0));return [(viewport[0]+(clip[0]/clip[3]+1)*viewport[2]/2)*box.width/canvas.width,(canvas.height-(viewport[1]+(clip[1]/clip[3]+1)*viewport[3]/2))*box.height/canvas.height,clip[2]/clip[3]];}
      let pick=null;
      for(let i=0;i<faces.length;i+=3){const center=[0,1,2].map(axis=>(points[faces[i]*3+axis]+points[faces[i+1]*3+axis]+points[faces[i+2]*3+axis])/3),screen=project(center);if(!pick||screen[2]<pick.screen[2])pick={screen,ras:center};}
      return {point_count:points.length/3,triangle_count:faces.length/3,coordinate_sha256:await sha(points),triangle_sha256:await sha(faces),matrix,viewport,
        canvas:[canvas.width,canvas.height],css:[box.width,box.height],target_screen:project(position),pick};
    },{expected:report.regions[structure.id].vertices,position:structure.target_ras_mm});
  }
  const savedState=()=>page.evaluate(key=>JSON.parse(localStorage.getItem('neuroimage:scene:'+key)).state,atlas.key);
  const record=async()=>{await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();return savedState();};
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();
  const full=await record();await shot('full-sections');
  assert(JSON.stringify(full.pan)==='[0,0,0,1]','Initial sections crop the source field of view.');
  await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();
  const magnified=await record();await shot('magnified-sections');
  await page.getByRole('button',{name:'Full sections',exact:true}).click();await ready();
  const returned=await record();await shot('full-sections-returned');
  assert(magnified.pan[3]===3&&JSON.stringify(returned.pan)==='[0,0,0,1]','Full-section/magnified controls failed.');
  for(const state of [magnified,returned])assert(JSON.stringify(state.position)===JSON.stringify(full.position)&&state.selected===full.selected,'View magnification changed source location or selection.');
  const sectionNavigation={full:full.pan,magnified:magnified.pan,returned:returned.pan,position:full.position};
  for(const structure of manifest.structures){
    await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();await choose(structure);await sample(structure,'source target');
    await page.getByRole('button',{name:'Isolate selected',exact:true}).click();await ready();
    await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await page.getByRole('button',{name:'Center 3D on cursor',exact:true}).click();await ready();
    geometries.push({id:structure.id,...await capture(structure)});
    await setPosition([0,0,0]);await sample(structure,'source origin background sample');
    assert(await page.locator('.coordinate-status').textContent()===structure.name,'Cursor sampling switched the selected independent field.');
  }
  const pag=manifest.structures.find(s=>s.source_name==='PAG'),rn=manifest.structures[0];
  await choose(pag);
  for(const [point,test] of [[[4,-35,-13],'source inclusive threshold'],[[5,-34,-12],'source support below mask threshold']]){await setPosition(point);await sample(pag,test);}
  await page.getByRole('button',{name:'Show matches',exact:true}).click();await ready();
  await setPosition([3,-30,-10]);
  await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  const overlap=await savedState();
  assert(JSON.stringify(overlap.selectionEvidence.candidates)===JSON.stringify(['brainstem_navigator_mni:region:DR','brainstem_navigator_mni:region:PAG']),'Independent source overlap was flattened or lost.');
  await page.getByLabel('Independent region memberships').getByRole('button',{name:'Dorsal raphe',exact:true}).click();await ready();
  assert(JSON.stringify(await position())===JSON.stringify(overlap.position),'Choosing another membership moved the cursor.');
  await page.getByLabel('Show Periaqueductal gray',{exact:true}).uncheck();await ready();
  await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();
  const afterHide=await savedState();assert(afterHide.selectionEvidence.candidates.length===1&&afterHide.selectionEvidence.candidates[0].endsWith(':DR'),'Hidden region remained in overlap candidates.');
  await choose(rn);await page.getByRole('button',{name:'Isolate selected',exact:true}).click();
  await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await page.getByRole('button',{name:'Center 3D on cursor',exact:true}).click();
  await page.getByLabel('View layout').selectOption('3d');await ready();
  const focused=await capture(rn),canvas=page.locator('canvas');
  assert(Math.abs(focused.target_screen[0]-focused.css[0]/2)<2&&Math.abs(focused.target_screen[1]-focused.css[1]/2)<2,'3D focus does not project the physical target at the view center.');
  await canvas.dblclick({position:{x:focused.pick.screen[0],y:focused.pick.screen[1]}});await ready();
  const surfacePick={position_ras_mm:await position(),selected:await page.locator('.coordinate-status').textContent()};assert(surfacePick.selected===rn.name,'3D source surface was not selected.');
  await choose(rn);await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();
  await page.getByLabel('View layout').selectOption('axial');await ready();
  const box=await canvas.boundingBox();await canvas.click({position:{x:box.width/2+6,y:box.height/2+3}});await ready();await sample(rn,'actual 2D pointer sample');
  const slicePick=await position();
  await choose(rn);await page.getByRole('button',{name:'Magnify at cursor',exact:true}).click();await ready();await shot('probability');
  await page.getByLabel('Surface opacity',{exact:true}).press('Home');await ready();await shot('probability-no-surface');
  await page.getByLabel('Evidence overlay').selectOption('mask');await ready();await shot('mask');
  await page.getByLabel('Label opacity',{exact:true}).press('Home');await ready();await shot('mri-only');
  await page.getByLabel('Label opacity',{exact:true}).press('End');await page.getByLabel('Surface opacity',{exact:true}).press('End');
  await page.getByLabel('Radiological',{exact:true}).uncheck();await ready();await shot('mask-neurological');
  assert(JSON.stringify(await position())===JSON.stringify(rn.target_ras_mm),'Orientation changed source coordinates.');
  await page.getByLabel('Radiological',{exact:true}).check();await page.getByLabel('Evidence overlay').selectOption('probability');
  await page.getByLabel('MRI contrast',{exact:true}).selectOption('fa');await ready();await sample(rn,'same source probability with FA context');
  await page.getByLabel('View layout').selectOption('quad');await page.getByLabel('Scene teaching notes').fill('Independent source regions: overlapping memberships and physical view centers.');
  await page.getByRole('button',{name:'Save scene',exact:true}).click();await ready();await shot('saved');
  const saved=await savedState();assert(saved.pan[3]===3&&JSON.stringify(saved.focus3D)===JSON.stringify(rn.target_ras_mm),'Scene lost physical section/3D focus.');
  const output='data/exports/brainstem_navigator_mni/browser-validation';
  let download=page.waitForEvent('download');await page.getByRole('button',{name:'Export scene',exact:true}).click();await(await download).saveAs(output+'/region-scene.json');
  download=page.waitForEvent('download');await page.getByRole('button',{name:'Export teaching image',exact:true}).click();await(await download).saveAs(output+'/region-teaching.zip');await ready();
  await page.getByRole('button',{name:'Reset view',exact:true}).click();await ready();await page.getByRole('button',{name:'Restore saved',exact:true}).click();await ready();await shot('restored');
  await page.reload();await ready();await page.getByLabel('Import scene file',{exact:true}).setInputFiles(output+'/region-scene.json');await ready();await shot('imported');
  const graphics=await canvas.evaluate(c=>{const gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return{renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError()};});
  assert(!errors.length&&!external.length&&graphics.error===0,JSON.stringify({errors,external,graphics}));
  return {status:'passed',package_version:manifest.package_version,probes,geometries,focused,surfacePick,slicePick,sectionNavigation,
    overlap:{position:overlap.position,candidates:overlap.selectionEvidence.candidates,after_hide:afterHide.selectionEvidence.candidates},graphics,page_errors:errors,external_requests:external,
    independent_source_and_pixel_check_required:true};
}
