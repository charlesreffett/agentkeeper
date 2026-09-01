import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const plugins = ['github', 'jira']

for (const id of plugins) {
  const root = resolve('plugins', id)
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
  const entries = [manifest.entry, manifest.renderer?.entry].filter(Boolean)
  for (const entry of entries) await readFile(resolve(root, entry))

  const backend = await readFile(resolve(root, manifest.entry), 'utf8')
  const imports = [...backend.matchAll(/\b(?:from|import)\s*(?:\(|)\s*["']([^"']+)["']/g)].map(match => match[1])
  const unresolved = imports.filter(specifier => !specifier.startsWith('.') && !specifier.startsWith('node:'))
  if (unresolved.length) {
    throw new Error(`${id} backend contains unpackaged runtime imports: ${unresolved.join(', ')}`)
  }
  await import(`file://${resolve(root, manifest.entry)}?verification=${Date.now()}`)
  console.log(`verified ${id}: self-contained backend and declared renderer`)
}
