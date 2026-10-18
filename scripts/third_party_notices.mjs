/** Retain licenses for the frontend's runtime dependency closure and embedded assets. */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const modules = path.join(root, 'node_modules'), packages = new Map()
function findPackage(name, parent) {
  let current = parent
  while (current.startsWith(root)) {
    const candidate = path.join(current, 'node_modules', name)
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate
    const above = path.dirname(current)
    if (above === current) break
    current = above
  }
  throw new Error(`Missing installed frontend dependency: ${name}`)
}
function visit(name, parent = root) {
  const folder = findPackage(name, parent)
  const metadata = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'))
  const key = `${metadata.name}@${metadata.version}`
  if (packages.has(key)) return
  packages.set(key, {folder, metadata})
  for (const dependency of Object.keys(metadata.dependencies ?? {})) visit(dependency, folder)
}
for (const name of ['@niivue/niivue', 'react', 'react-dom', 'fflate']) visit(name)
const sections = ['NeuroImage frontend third-party notices\n\nSoftware licenses below apply to bundled dependencies and renderer assets. Source dataset licenses are separate and accompany each independently constructed atlas. The dependency closure may include optional format readers not used by the current NIfTI/GIFTI workflow.\n']
for (const [name, {folder, metadata}] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  let licenses = fs.readdirSync(folder).filter(file => /^(license|copying|notice)(\.|$)/i.test(file))
  if (name.startsWith('@niivue/niivue@')) licenses = []
  if (!licenses.length && !name.startsWith('@niivue/niivue@')) throw new Error(`No retained license found for ${name}`)
  sections.push(`\n===== ${name} =====\nDeclared license: ${metadata.license ?? 'See retained notice'}\n`)
  for (const file of licenses) sections.push(fs.readFileSync(path.join(folder, file), 'utf8'))
  if (name.startsWith('@niivue/niivue@')) sections.push(fs.readFileSync(path.join(root, 'docs/licenses/software/niivue-BSD-2-Clause.txt'), 'utf8'))
}
const supplemental = path.join(root, 'docs/licenses/software')
for (const file of fs.readdirSync(supplemental).filter(file => file.endsWith('.txt') && !file.startsWith('niivue-')).sort()) {
  sections.push(`\n===== Embedded renderer/codec notice: ${file} =====\n`, fs.readFileSync(path.join(supplemental, file), 'utf8'))
}
sections.push('\n===== Retained upstream source records =====\n', fs.readFileSync(path.join(supplemental, 'source-records.json'), 'utf8'))
const output = path.join(root, 'web/public/third-party-notices.txt')
fs.writeFileSync(output, sections.join('\n'))
console.log(`Retained notices for ${packages.size} frontend dependency releases in web/public/third-party-notices.txt`)
