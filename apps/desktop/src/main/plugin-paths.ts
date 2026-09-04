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
  const canonicalEntries = new Map<string, string>()
  for (const entry of entries) {
    const normalized = entry.replace(/\/$/, '')
    if (!normalized) continue
    if (
      normalized.startsWith('/') ||
      /^[a-z]:/i.test(normalized) ||
      normalized.includes('\0') ||
      normalized.includes('\\') ||
      normalized.split('/').some(part => part === '' || part === '..' || part === '.')
    ) {
      throw new Error(`Plugin archive contains an unsafe path: ${entry}`)
    }

    // The installed plugin directory may live on a case-insensitive filesystem
    // (the default on macOS and Windows). Unicode-equivalent and case-equivalent
    // names therefore target the same file even if ZIP treats them as distinct.
    // Reject them before extraction so the reviewed file cannot be overwritten by
    // a later colliding entry.
    const canonical = normalized.normalize('NFC').toLowerCase()
    const previous = canonicalEntries.get(canonical)
    if (previous !== undefined) {
      throw new Error(`Plugin archive contains duplicate paths: ${previous} and ${entry}`)
    }
    canonicalEntries.set(canonical, entry)
  }
}
