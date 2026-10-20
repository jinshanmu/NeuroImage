/** A verified package can provide lossless, predecoded browser representations. */
export class RenderAssets {
  private files = new Map<string, string>()
  constructor(private base: string) {}

  async load(assets: {path: string; sha256: string}[], signal: AbortSignal) {
    const response = await fetch(this.base + '_render.json', { signal })
    if (response.status === 404) return // Older read-only package servers.
    if (!response.ok) throw Error('Could not load the browser asset catalog.')
    const catalog = await response.json()
    if (catalog.schema_version !== '1.0' || !catalog.assets || typeof catalog.assets !== 'object')
      throw Error('Invalid browser asset catalog.')
    for (const asset of assets) {
      const entry = catalog.assets[asset.path]
      if (!entry) continue
      const extension = entry.format === 'mask' ? '.nim' : entry.format === 'mesh' ? '.ngm' : entry.format === 'volume' ? '.nii' : ''
      if (!extension || entry.source_sha256 !== asset.sha256 || !/^[a-f0-9]{64}$/.test(asset.sha256)
        || entry.file !== asset.sha256 + extension || !Number.isSafeInteger(entry.bytes) || entry.bytes < 8)
        throw Error('Browser assets disagree with their original source package.')
      this.files.set(asset.path, entry.file)
    }
  }

  url(file: string) { return this.base + (this.files.has(file) ? '_render/' + this.files.get(file) : file) }
  isPreparedMesh(file: string) { return this.files.get(file)?.endsWith('.ngm') ?? false }
}
