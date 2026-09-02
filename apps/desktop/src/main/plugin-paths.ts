import fs from 'node:fs'
import path from 'node:path'

export function resolvePluginPath(root: string, relativePath: string, label: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error(`${label} must be a relative path inside the plugin directory`)
  }
  const resolvedRoot = path.resolve(root)
  const resolved = path.resolve(resolvedRoot, relativePath)
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside the plugin directory: ${relativePath}`)
  }
  return resolved
}

export function requirePluginFile(root: string, relativePath: string, label: string): string {
  const resolvedRoot = fs.realpathSync(root)
  const candidate = resolvePluginPath(resolvedRoot, relativePath, label)
  const resolved = fs.realpathSync(candidate)
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} resolves outside the plugin directory: ${relativePath}`)
  }
  if (!fs.statSync(resolved).isFile()) {
    throw new Error(`${label} is not a file: ${relativePath}`)
  }
  return resolved
}

export function validatePluginArchiveEntries(entries: readonly string[]): void {
  for (const entry of entries) {
    const normalized = entry.replace(/\/$/, '')
    if (!normalized) continue
    if (
      normalized.startsWith('/') ||
      normalized.includes('\\') ||
      normalized.split('/').some(part => part === '..' || part === '.')
    ) {
      throw new Error(`Plugin archive contains an unsafe path: ${entry}`)
    }
  }
}

