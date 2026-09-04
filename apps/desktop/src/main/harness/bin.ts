import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { settingsStore } from '../settings'

/** Resolve which binary a harness shells out to. The app shells bare
 *  `claude`/`opencode` everywhere a subprocess is started, which breaks on
 *  non-PATH installs and leaves no seam for forks or CLI-wrapping harnesses.
 *  This helper is that seam — every spawn goes through it. */
export interface BinConfig {
  /** Harness id — key into settings.harnessBins for a per-harness override. */
  harnessId: string
  /** Candidate binary names tried in PATH order, e.g. ['opencode']. */
  fallbackBins: string[]
  /** env var override, e.g. 'OPENCODE_BIN' / 'CLAUDE_BIN'. */
  envVar: string
}

const CANDIDATE_EXTENSIONS = process.platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : ['']

/** GUI apps on macOS inherit launchd's minimal PATH rather than the user's
 * interactive-shell PATH. Include the conventional per-user CLI locations so
 * a preview/packaged build sees the same harness installs as the dev build. */
export function executableSearchDirs(
  envPath = process.env.PATH ?? '',
  home = os.homedir(),
  platform = process.platform,
): string[] {
  const pathDirs = envPath.split(path.delimiter).filter(Boolean)
  if (platform === 'win32') return [...new Set(pathDirs)]

  const userDirs = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.opencode', 'bin'),
    path.join(home, '.grok', 'bin'),
    path.join(home, '.cargo', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    ...(platform === 'darwin' ? [path.join(home, 'Library', 'pnpm')] : []),
  ]
  const systemDirs = platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin']
    : ['/usr/local/bin']

  return [...new Set([...pathDirs, ...userDirs, ...systemDirs])]
}

function isExecutable(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Resolve a binary name (PATH search) or an explicit path (existence + X_OK). */
function which(bin: string): string | null {
  if (bin.includes('/') || bin.includes('\\')) {
    return isExecutable(bin) ? bin : null
  }
  for (const dir of executableSearchDirs()) {
    for (const ext of CANDIDATE_EXTENSIONS) {
      const candidate = path.join(dir, bin + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return null
}

/** Resolve the binary for a harness, in precedence order:
 *  1. settings.harnessBins[harnessId] — explicit per-harness path override
 *  2. ${envVar} — e.g. OPENCODE_BIN / CLAUDE_BIN
 *  3. each fallbackBins entry, resolved against PATH
 *  Returns null when nothing resolves — the harness has no runnable binary. */
export function resolveBin(config: BinConfig): string | null {
  const override = settingsStore.get().harnessBins?.[config.harnessId]
  if (override) {
    if (which(override)) return override
    console.warn(`[harness] configured bin for "${config.harnessId}" not executable: ${override} — falling back to PATH`)
  }

  const envBin = process.env[config.envVar]
  if (envBin) {
    if (which(envBin)) return envBin
    console.warn(`[harness] ${config.envVar} not executable: ${envBin} — falling back to PATH`)
  }

  for (const bin of config.fallbackBins) {
    const resolved = which(bin)
    if (resolved) return resolved
  }
  return null
}
