import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectPackageFiles, requirePackagedFile } from './pack.js'

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'agentkeeper-pack-'))
  mkdirSync(join(root, 'dist'))
  mkdirSync(join(root, 'src'))
  mkdirSync(join(root, 'renderer'))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'manifest.json'), '{}')
  writeFileSync(join(root, 'package.json'), '{}')
  writeFileSync(join(root, 'dist', 'index.js'), 'export default {}')
  writeFileSync(join(root, 'dist', 'renderer.js'), '(() => {})()')
  writeFileSync(join(root, 'dist', 'index.js.map'), '{}')
  writeFileSync(join(root, 'src', 'index.ts'), 'export default {}')
  writeFileSync(join(root, 'renderer', 'index.ts'), '')
  writeFileSync(join(root, 'node_modules', 'dependency.js'), '')
  writeFileSync(join(root, 'plugin.akp'), '')
  writeFileSync(join(root, 'tsconfig.json'), '{}')
  return root
}

describe('plugin packaging', () => {
  it('includes only runtime package files', () => {
    expect(collectPackageFiles(fixture())).toEqual([
      'dist/index.js',
      'dist/renderer.js',
      'manifest.json',
      'package.json',
    ])
  })

  it('requires built entries inside the plugin directory', () => {
    const root = fixture()
    expect(() => requirePackagedFile(root, 'dist/index.js', 'Plugin entry')).not.toThrow()
    expect(() => requirePackagedFile(root, 'dist/missing.js', 'Plugin entry')).toThrow(/Build the plugin/)
    expect(() => requirePackagedFile(root, '../outside.js', 'Plugin entry')).toThrow(/inside the plugin directory/)
  })
})
