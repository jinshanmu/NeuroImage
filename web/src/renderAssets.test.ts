import { afterEach, expect, it, vi } from 'vitest'
import { RenderAssets } from './renderAssets'
import { patchGradientHook } from './niivuePatch'
import { readFileSync } from 'node:fs'

afterEach(() => vi.unstubAllGlobals())
const sha = 'a'.repeat(64), asset = {path:'meshes/original.gii',sha256:sha}
it('binds browser geometry to the exact source checksum and retains other source URLs',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
    schema_version:'1.0',assets:{[asset.path]:{file:sha+'.ngm',format:'mesh',source_sha256:sha,bytes:60}},
  }))))
  const resources = new RenderAssets('/atlas/source/')
  await resources.load([asset],new AbortController().signal)
  expect(resources.url(asset.path)).toBe('/atlas/source/_render/'+sha+'.ngm')
  expect(resources.isPreparedMesh(asset.path)).toBe(true)
  expect(resources.url('image.nii.gz')).toBe('/atlas/source/image.nii.gz')
})
it('rejects unbound cache files and falls back only for older servers',async()=>{
  const resources = new RenderAssets('/atlas/source/')
  for (const change of [{source_sha256:'b'.repeat(64)},{file:'../../other.ngm'},{format:'other'}]) {
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({
      schema_version:'1.0',assets:{[asset.path]:{file:sha+'.ngm',format:'mesh',source_sha256:sha,bytes:60,...change}},
    }))))
    await expect(resources.load([asset],new AbortController().signal)).rejects.toThrow('disagree')
  }
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:404})))
  await resources.load([asset],new AbortController().signal)
  expect(resources.url(asset.path)).toBe('/atlas/source/'+asset.path)
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:503})))
  await expect(resources.load([asset],new AbortController().signal)).rejects.toThrow('catalog')
})
it('commits a complete catalog only after validation and clears prepared routes on a source fallback',async()=>{
  const other={path:'meshes/other.gii',sha256:'b'.repeat(64)}
  const entry=(item:typeof asset)=>({file:item.sha256+'.ngm',format:'mesh',source_sha256:item.sha256,bytes:60})
  const fetch=vi.fn()
  vi.stubGlobal('fetch',fetch)
  const resources=new RenderAssets('/atlas/source/')
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({schema_version:'1.0',assets:{[asset.path]:entry(asset),[other.path]:{...entry(other),source_sha256:sha}}})))
  await expect(resources.load([asset,other],new AbortController().signal)).rejects.toThrow('disagree')
  expect(resources.url(asset.path)).toBe('/atlas/source/'+asset.path)
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({schema_version:'1.0',assets:{[asset.path]:entry(asset)}})))
  await resources.load([asset],new AbortController().signal)
  expect(resources.isPreparedMesh(asset.path)).toBe(true)
  fetch.mockResolvedValueOnce(new Response('',{status:404}))
  await resources.load([asset],new AbortController().signal)
  expect(resources.url(asset.path)).toBe('/atlas/source/'+asset.path)
  expect(resources.isPreparedMesh(asset.path)).toBe(false)
})
it('does not apply a catalog after cancellation or start a cancelled read',async()=>{
  const controller=new AbortController(),resources=new RenderAssets('/atlas/source/')
  const fetch=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>{
    controller.abort()
    return {schema_version:'1.0',assets:{[asset.path]:{file:sha+'.ngm',format:'mesh',source_sha256:sha,bytes:60}}}
  }})
  vi.stubGlobal('fetch',fetch)
  await expect(resources.load([asset],controller.signal)).rejects.toMatchObject({name:'AbortError'})
  expect(resources.isPreparedMesh(asset.path)).toBe(false)
  await expect(resources.load([asset],controller.signal)).rejects.toMatchObject({name:'AbortError'})
  expect(fetch).toHaveBeenCalledOnce()
})
it('routes exactly one pinned gradient call through the existing renderer hook',()=>{
  const original = readFileSync('node_modules/@niivue/niivue/build/niivue/index.js','utf8')
  const result = patchGradientHook(original)
  expect(result).toContain('this.volumeTexture = outTexture;\n      this.gradientGL(hdr);')
  expect(result).toContain('this.gradientTexture = gradientGL({')
  expect(()=>patchGradientHook(result)).toThrow('hook changed')
})
