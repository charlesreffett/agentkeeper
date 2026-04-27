import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitStatus, RemoteSource } from '../shared/ipc-contract'

// ─── Mutation helpers ────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile)

export async function getBranch(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'rev-parse', '--abbrev-ref', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function getStatus(projectPath: string): Promise<GitStatus> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'status', '--porcelain'])
    const staged: GitStatus['staged'] = []
    const unstaged: GitStatus['unstaged'] = []
    const untracked: string[] = []

    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      const xy = line.slice(0, 2)
      const filePath = line.slice(3)
      const x = xy[0]!
      const y = xy[1]!

      if (xy === '??') {
        untracked.push(filePath)
      } else {
        if (x !== ' ' && x !== '?') staged.push({ path: filePath, status: x })
        if (y !== ' ' && y !== '?') unstaged.push({ path: filePath, status: y })
      }
    }

    return { staged, unstaged, untracked }
  } catch {
    return { staged: [], unstaged: [], untracked: [] }
  }
}

// Max diff size sent to Claude — large monorepo diffs stay manageable
const MAX_DIFF_BYTES = 40_000

export async function getDiff(projectPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'diff', 'HEAD'])
    return stdout.length > MAX_DIFF_BYTES ? stdout.slice(0, MAX_DIFF_BYTES) + '\n…(truncated)' : stdout
  } catch {
    return ''
  }
}

export async function stageFiles(projectPath: string, files: string[]): Promise<void> {
  if (!files.length) return
  await execFileAsync('git', ['-C', projectPath, 'add', '--', ...files])
}

export async function unstageFiles(projectPath: string, files: string[]): Promise<void> {
  if (!files.length) return
  await execFileAsync('git', ['-C', projectPath, 'restore', '--staged', '--', ...files])
}

export async function commit(projectPath: string, message: string): Promise<void> {
  await execFileAsync('git', ['-C', projectPath, 'commit', '-m', message])
}

export async function push(projectPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', projectPath, 'push'])
    return (stdout + stderr).trim()
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    throw new Error(e.stderr?.trim() || e.message || 'git push failed')
  }
}

export async function detectRemoteSources(projectPath: string): Promise<RemoteSource[]> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'remote', '-v'])
    const seen = new Set<string>()
    const results: RemoteSource[] = []

    for (const line of stdout.split('\n')) {
      // Only process fetch lines to avoid duplicates from push entries
      const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line)
      if (!match) continue
      const remote = match[1] as string
      const url = match[2] as string

      type HostType = RemoteSource['type']
      let type: HostType | null = null
      let slug: string | null = null

      if (url.includes('github.com')) {
        type = 'github'
        const m =
          /git@github\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url) ??
          /https:\/\/github\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url)
        slug = m?.[1] ?? null
      } else if (url.includes('gitlab.com')) {
        type = 'gitlab'
        const m =
          /git@gitlab\.com:([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url) ??
          /https:\/\/gitlab\.com\/([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url)
        slug = m?.[1] ?? null
      } else if (url.includes('bitbucket.org')) {
        type = 'bitbucket'
        const m =
          /git@bitbucket\.org:([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url) ??
          /https:\/\/bitbucket\.org\/([^/]+\/[^/\s]+?)(?:\.git)?$/.exec(url)
        slug = m?.[1] ?? null
      }

      if (!type || !slug) continue

      const key = `${type}:${slug}`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({ type, repo: slug, remote, url })
    }

    return results
  } catch {
    return []
  }
}
