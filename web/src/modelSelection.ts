import type { Vec3 } from './types'

const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const minus=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]]
function segmentDistance(p:Vec3,a:Vec3,b:Vec3) {
  const ab=minus(b,a), ap=minus(p,a), length=dot(ab,ab)
  const t=length?Math.max(0,Math.min(1,dot(ap,ab)/length)):0
  return ap.reduce((sum,value,i)=>sum+(value-t*ab[i])**2,0)
}
/** Distance to a filled triangle, including coarse polygons far from vertices. */
export function triangleDistanceSquared(p:Vec3,a:Vec3,b:Vec3,c:Vec3):number {
  const ab=minus(b,a), ac=minus(c,a), ap=minus(p,a)
  const d00=dot(ab,ab),d01=dot(ab,ac),d11=dot(ac,ac),d20=dot(ap,ab),d21=dot(ap,ac),denominator=d00*d11-d01*d01
  if(denominator>1e-20) {
    const v=(d11*d20-d01*d21)/denominator,w=(d00*d21-d01*d20)/denominator
    if(v>=0&&w>=0&&v+w<=1)return ap.reduce((sum,value,i)=>sum+(value-v*ab[i]-w*ac[i])**2,0)
  }
  return Math.min(segmentDistance(p,a,b),segmentDistance(p,b,c),segmentDistance(p,c,a))
}

export function pickModelSurface(position:Vec3,meshes:Map<string,{pts:Float32Array;tris?:Uint32Array;visible:boolean;opacity:number}>,
  bounds:Map<string,[Vec3,Vec3]>,current:string|null,accept:(id:string)=>boolean=()=>true,tolerance=.08) {
  const hits:{id:string;distance:number}[]=[]
  for(const [id,mesh] of meshes) {
    if(!mesh.visible||mesh.opacity<=0||!mesh.tris||!accept(id))continue
    const box=bounds.get(id)
    if(box&&position.some((v,i)=>v<box[0][i]-tolerance||v>box[1][i]+tolerance))continue
    let distance=Infinity
    const point=(index:number):Vec3=>[mesh.pts[3*index],mesh.pts[3*index+1],mesh.pts[3*index+2]]
    for(let i=0;i<mesh.tris.length;i+=3) distance=Math.min(distance,triangleDistanceSquared(position,point(mesh.tris[i]),point(mesh.tris[i+1]),point(mesh.tris[i+2])))
    if(distance<=tolerance*tolerance)hits.push({id,distance})
  }
  hits.sort((a,b)=>a.distance-b.distance)
  return hits.find(hit=>hit.id===current&&hit.distance<=hits[0].distance+1e-5)?.id??hits[0]?.id??null
}
