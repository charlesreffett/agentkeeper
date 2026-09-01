import { Command } from 'commander'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { PluginManifestSchema } from '@agentkeeper/sdk'

const DEFAULT_IGNORE = [
  'node_modules/',
  'src/',
  'renderer/',
  'tsconfig.json',
  '*.akp',
  '*.map',
  '.git/',
  '*.ts',
]

function makeIgnoreMatcher(patterns: string[]): (relPath: string) => boolean {
  return (relPath: string) => {
    for (const p of patterns) {
      if (p.startsWith('!')) continue
      const normalized = p.replace(/\/$/, '')
      if (relPath === normalized || relPath.startsWith(normalized + '/')) return true
      if (p.startsWith('*.')) {
        const ext = p.slice(1)
        if (relPath.endsWith(ext)) return true
      }
    }
    return false
  }
}

function parseAkpIgnore(content: string): string[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith('#'))
}

export function requirePackagedFile(root: string, entry: string, label: string): void {
  const resolved = path.resolve(root, entry)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the plugin directory: ${entry}`)
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} does not exist. Build the plugin before packing: ${entry}`)
  }
}

export function collectPackageFiles(root: string, extraIgnorePatterns: string[] = []): string[] {
  const shouldIgnore = makeIgnoreMatcher([...DEFAULT_IGNORE, ...extraIgnorePatterns])
  function collect(rel: string): string[] {
    const files: string[] = []
    for (const entry of fs.readdirSync(path.join(root, rel || '.'), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (shouldIgnore(relPath)) continue
      if (entry.isDirectory()) files.push(...collect(relPath))
      else files.push(relPath)
    }
    return files
  }
  return collect('').sort((a, b) => a.localeCompare(b))
}

export const packCommand = new Command('pack')
  .description('Pack a plugin directory into a .akp file')
  .option('-d, --dir <path>', 'Plugin directory (default: cwd)', process.cwd())
  .action(async (options: { dir: string }) => {
    const dir = path.resolve(options.dir)

    // 1. Read and validate manifest
    const manifestPath = path.join(dir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      console.error('Error: manifest.json not found in', dir)
      process.exit(1)
    }
    let manifestRaw: unknown
    try {
      manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (e) {
      console.error('Error: could not parse manifest.json:', e)
      process.exit(1)
    }
    const result = PluginManifestSchema.safeParse(manifestRaw)
    if (!result.success) {
      console.error('Error: invalid manifest.json:')
      for (const [field, msgs] of Object.entries(result.error.flatten().fieldErrors)) {
        console.error(`  ${field}: ${(msgs as string[]).join(', ')}`)
      }
      process.exit(1)
    }
    const manifest = result.data

    try {
      requirePackagedFile(dir, manifest.entry, 'Plugin entry')
      if (manifest.renderer) requirePackagedFile(dir, manifest.renderer.entry, 'Renderer entry')
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }

    // 2. Build ignore rules
    const ignorePatterns = [...DEFAULT_IGNORE]
    const akpignorePath = path.join(dir, '.akpignore')
    if (fs.existsSync(akpignorePath)) {
      ignorePatterns.push(...parseAkpIgnore(fs.readFileSync(akpignorePath, 'utf8')))
    }
    // 3. Collect files
    const files = collectPackageFiles(dir, ignorePatterns.slice(DEFAULT_IGNORE.length))
    console.log(`Packing ${files.length} files...`)

    // 4. Build zip
    const zip = new AdmZip()
    for (const relPath of files) {
      const absPath = path.join(dir, relPath)
      zip.addFile(relPath, fs.readFileSync(absPath))
    }
    const outName = `${manifest.id}-${manifest.version}.akp`
    const outPath = path.join(dir, outName)
    zip.writeZip(outPath)

    // 5. SHA-256 + size
    const buf = fs.readFileSync(outPath)
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex')
    const kb = (buf.byteLength / 1024).toFixed(1)

    console.log(`\nOutput:  ${outPath}`)
    console.log(`Size:    ${kb} KB`)
    console.log(`SHA-256: ${sha256}`)
  })
