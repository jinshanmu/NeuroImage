import { zipSync, strToU8 } from 'fflate'
import { download } from './scene'
import { modelScene } from './modelScene'
import type { ModelView, SurfaceManifest } from './modelTypes'

export async function exportModelImage(imageURL:string,manifest:SurfaceManifest,state:ModelView,base:string) {
  const image=new Image();image.src=imageURL;await image.decode()
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!
  const selected=manifest.structures.find(item=>item.id===state.selected)
  const lines=[manifest.title+' | '+manifest.space.name,
    'Independent source model | Native SOURCE_XYZ in mm | Original author geometry',
    'Selected source object: '+(selected?.name??'none')+' | Native position: '+state.position_native_mm.map(v=>v.toFixed(2)).join(', '),
    state.highlightSelected?'Selected object is highlighted in cyan for display; foreground objects retain their source colors.':'Original foreground object colors.',
    ...(state.surfaceContext?.enabled?[`Same-source brain context: neutral gray, ${Math.round(state.surfaceContext.opacity*100)}% opacity; separate from the selected structures.`]:[]),
    ...state.annotations.filter(item=>item.source_annotation).map(item=>'Original source annotation: '+item.source_annotation!.spec.source_object+' | Author-indicated endpoint 1'),
    'Native XYZ follows the source model axes and the declared metric conversion. The complete coordinate definition accompanies this export.',
    ...manifest.sources.map(source=>source.title+' | '+source.version+' | '+source.license_name),
    ...(state.surfaceCutaway?[`Native XYZ display cutaway: axis ${['X','Y','Z'][state.surfaceCutaway.axis]}, ${state.surfaceCutaway.position_mm.toFixed(2)} mm. Open source surfaces; no generated cap.`]:[]),
    'Package '+manifest.package_version+' | Viewer '+__NEUROIMAGE_VIEWER__.version,
    'Source attribution, complete licenses, processing and source-bound scene accompany this image.']
  canvas.width=Math.max(1000,image.width);context.font='15px sans-serif'
  const wrapped=lines.flatMap(line=>{
    const rows:string[]=[];let current=''
    for(const word of line.split(/\s+/)){const next=current?current+' '+word:word;if(current&&context.measureText(next).width>canvas.width-40){rows.push(current);current=word}else current=next}
    rows.push(current);return rows
  })
  canvas.height=image.height+35+wrapped.length*24
  context.fillStyle='#0b1520';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0)
  context.fillStyle='#cad5df';context.font='15px sans-serif';wrapped.forEach((line,i)=>context.fillText(line,20,image.height+28+i*24))
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Image export failed.')),'image/png'))
  const files:Record<string,Uint8Array>={
    'anatomy.png':new Uint8Array(await blob.arrayBuffer()),
    'scene.json':strToU8(JSON.stringify(modelScene(manifest,state),null,2)),
    'provenance.json':strToU8(JSON.stringify(manifest,null,2)),
    'rendering.json':strToU8(JSON.stringify(__NEUROIMAGE_VIEWER__,null,2)),
    'teaching-notes.txt':strToU8([state.note,'',...state.annotations.map((item,i)=>`${i+1}. ${item.text}\nSOURCE_XYZ mm: ${item.position_native_mm.join(', ')}\nSource object: ${item.structure_id??'none'}`)].join('\n')),
    'README.txt':strToU8('NeuroImage independent model teaching export\n\nRetain all source licenses, attribution and processing records. Source licenses govern the derived image. SOURCE_XYZ retains the original source axes. Source annotation markers carry their original input, author-indicated endpoint and metric transform; added markers and notes record user observations. Scene restoration uses the exact original local model package. This export contains the image, source-bound scene, notes, processing metadata and attribution.\n'),
  }
  const sourceAnnotations=state.annotations.flatMap(item=>item.source_annotation?[item.source_annotation]:[])
  if(sourceAnnotations.length)files['source-annotations.json']=strToU8(JSON.stringify(sourceAnnotations,null,2))
  for(const license of manifest.assets.filter(item=>item.role==='license')) {
    const response=await fetch(base+license.path);if(!response.ok)throw Error('A required source license could not be included. Export cancelled.')
    files[license.path]=new Uint8Array(await response.arrayBuffer())
  }
  download(zipSync(files,{level:6}).buffer as ArrayBuffer,manifest.package_id+'-model-teaching-export.zip','application/zip')
}
