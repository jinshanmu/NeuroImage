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
it('routes exactly one pinned gradient call through the existing renderer hook',()=>{
  const original = readFileSync('node_modules/@niivue/niivue/build/niivue/index.js','utf8')
  const result = patchGradientHook(original)
  expect(result).toContain('this.volumeTexture = outTexture;\n      this.gradientGL(hdr);')
  expect(result).toContain('this.gradientTexture = gradientGL({')
  expect(()=>patchGradientHook(result)).toThrow('hook changed')
})
