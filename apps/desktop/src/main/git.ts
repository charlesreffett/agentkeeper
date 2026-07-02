import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { BranchInfo, GitStatus, RemoteSource, SwitchBranchOptions, SwitchResult } from '../shared/ipc-contract'

// ─── Mutation helpers ────────────────────────────────────────────────────────

const execFileAsync = promisify(execFile)

export async function getBranch(projectPath: string): Promise<string | null> {
  try {
    // symbolic-ref (not rev-parse --abbrev-ref) so detached HEAD yields null
    // instead of the literal string "HEAD".
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'symbolic-ref', '--short', '-q', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function getStatus(projectPath: string): Promise<GitStatus> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'status', '--porcelain', '-uall'])
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

export async function pull(projectPath: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['-C', projectPath, 'pull'])
    return (stdout + stderr).trim()
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string }
    throw new Error(e.stderr?.trim() || e.message || 'git pull failed')
  }
}

export async function createBranch(projectPath: string, branchName: string): Promise<void> {
  await execFileAsync('git', ['-C', projectPath, 'checkout', '-b', branchName])
}

// ─── Branch listing & switching ──────────────────────────────────────────────

function parseTrack(track: string): { ahead: number; behind: number } {
  // %(upstream:track) → "[ahead 1, behind 2]", "[ahead 1]", "[behind 2]", "[gone]" or ""
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  return { ahead: ahead ? Number(ahead[1]) : 0, behind: behind ? Number(behind[1]) : 0 }
}

/** branch name → worktree path, for branches checked out in linked worktrees (main repo excluded). */
async function worktreeBranchMap(projectPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'worktree', 'list', '--porcelain'])
    let wtPath: string | null = null
    let isFirst = true
    for (const line of stdout.split('\n')) {
      if (line.startsWith('worktree ')) {
        wtPath = line.slice('worktree '.length)
      } else if (line.startsWith('branch ') && wtPath) {
        // First entry is the main repo itself — its branch is "current", not locked.
        if (!isFirst) map.set(line.slice('branch refs/heads/'.length), wtPath)
      } else if (line === '') {
        if (wtPath) isFirst = false
        wtPath = null
      }
    }
  } catch {
    // not fatal — worktree info is decoration only
  }
  return map
}

/** Checkout-recency ranks from the reflog: branch name → ordinal (0 = most recent). */
async function recentCheckoutRanks(projectPath: string): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'reflog', '--format=%gs', '-n', '200'])
    let rank = 0
    for (const line of stdout.split('\n')) {
      const m = /^checkout: moving from \S+ to (\S+)$/.exec(line)
      // Detached-HEAD targets are SHAs — they simply never match a branch name.
      if (m && !map.has(m[1]!)) map.set(m[1]!, rank++)
    }
  } catch {
    // no reflog (fresh clone, disabled) — recency is decoration only
  }
  return map
}

/** Default branch short name: origin/HEAD target, falling back to main/master. */
async function defaultBranchName(projectPath: string, localNames: Set<string>): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', projectPath, 'symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'])
    const target = stdout.trim() // "origin/main"
    if (target) return target.slice(target.indexOf('/') + 1)
  } catch {
    // no origin/HEAD (no remote, or never cloned) — fall through
  }
  if (localNames.has('main')) return 'main'
  if (localNames.has('master')) return 'master'
  return null
}

export async function listBranches(projectPath: string): Promise<BranchInfo[]> {
  const SEP = '\x1f'
  const format = ['%(refname)', '%(HEAD)', '%(upstream:short)', '%(upstream:track)', '%(committerdate:iso8601)', '%(contents:subject)'].join(SEP)
  const [{ stdout }, wtMap, recentRanks] = await Promise.all([
    execFileAsync('git', ['-C', projectPath, 'for-each-ref', `--format=${format}`, 'refs/heads', 'refs/remotes']),
    worktreeBranchMap(projectPath),
    recentCheckoutRanks(projectPath),
  ])

  const locals: BranchInfo[] = []
  const remotes: BranchInfo[] = []
  const localNames = new Set<string>()

  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    const [refname = '', head = '', upstream = '', track = '', date = '', subject = ''] = line.split(SEP)

    if (refname.startsWith('refs/heads/')) {
      const name = refname.slice('refs/heads/'.length)
      localNames.add(name)
      const { ahead, behind } = parseTrack(track)
      locals.push({
        name,
        isCurrent: head === '*',
        isDefault: false, // resolved below
        isRemote: false,
        upstream: upstream || null,
        ahead,
        behind,
        lastCommitSubject: subject,
        lastCommitDate: date,
        worktreePath: wtMap.get(name) ?? null,
        recentRank: recentRanks.get(name) ?? null,
      })
    } else if (refname.startsWith('refs/remotes/')) {
      const name = refname.slice('refs/remotes/'.length)
      // Skip the symbolic <remote>/HEAD ref.
      if (/^[^/]+\/HEAD$/.test(name)) continue
      remotes.push({
        name,
        isCurrent: false,
        isDefault: false,
        isRemote: true,
        upstream: null,
        ahead: 0,
        behind: 0,
        lastCommitSubject: subject,
        lastCommitDate: date,
        worktreePath: null,
        recentRank: null,
      })
    }
  }

  // Hide remote branches whose short name already exists locally — the local
  // row carries the upstream/ahead/behind info.
  const visibleRemotes = remotes.filter((r) => {
    const short = r.name.slice(r.name.indexOf('/') + 1)
    return !localNames.has(short)
  })

  const defaultName = await defaultBranchName(projectPath, localNames)
  if (defaultName) {
    for (const b of locals) if (b.name === defaultName) b.isDefault = true
    // Remote-only default (never checked out locally) — still surfaces first.
    for (const b of visibleRemotes) {
      if (b.name.slice(b.name.indexOf('/') + 1) === defaultName) b.isDefault = true
    }
  }

  // Default branch always first within each section.
  const defaultFirst = (a: BranchInfo, b: BranchInfo) => Number(b.isDefault) - Number(a.isDefault)
  locals.sort(defaultFirst)
  visibleRemotes.sort(defaultFirst)

  return [...locals, ...visibleRemotes]
}

async function hasTrackedChanges(projectPath: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['-C', projectPath, 'status', '--porcelain'])
  // Untracked-only trees count as clean — git switch carries them trivially.
  return stdout.split('\n').some((l) => l.trim() && !l.startsWith('??'))
}

function classifyGitError(err: unknown): SwitchResult {
  const e = err as { stderr?: string; message?: string }
  const reason = (e.stderr ?? e.message ?? 'git switch failed').trim()
  if (reason.includes('would be overwritten by checkout')) {
    return { ok: false, blocked: 'conflict', reason }
  }
  return { ok: false, blocked: 'git-error', reason }
}

async function refExists(projectPath: string, ref: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', projectPath, 'rev-parse', '--verify', '--quiet', ref])
    return true
  } catch {
    return false
  }
}

export async function switchBranch(
  projectPath: string,
  name: string,
  opts?: SwitchBranchOptions,
): Promise<SwitchResult> {
  try {
    if (!opts?.allowDirty && (await hasTrackedChanges(projectPath))) {
      // Soft-reject: AgentKeeper's own gate, git untouched. Force = retry with
      // allowDirty; the switch itself always carries changes, never discards.
      return { ok: false, blocked: 'dirty' }
    }

    let args: string[]
    if (await refExists(projectPath, `refs/heads/${name}`)) {
      args = ['switch', name]
    } else if (await refExists(projectPath, `refs/remotes/${name}`)) {
      // Remote row selected. Passing "origin/foo" verbatim would detach HEAD.
      const short = name.slice(name.indexOf('/') + 1)
      args = (await refExists(projectPath, `refs/heads/${short}`))
        ? ['switch', short]
        : ['switch', '--track', name]
    } else {
      args = ['switch', name]
    }

    await execFileAsync('git', ['-C', projectPath, ...args])
    return { ok: true }
  } catch (err) {
    return classifyGitError(err)
  }
}

export async function switchBranchCreate(
  projectPath: string,
  name: string,
  from?: string,
): Promise<SwitchResult> {
  // No dirty gate: `git switch -c` targets a brand-new branch — nothing to overwrite.
  try {
    if (await refExists(projectPath, `refs/heads/${name}`)) {
      return { ok: false, blocked: 'git-error', reason: `Branch "${name}" already exists` }
    }
    const args = ['switch', '-c', name, ...(from ? [from] : [])]
    await execFileAsync('git', ['-C', projectPath, ...args])
    return { ok: true }
  } catch (err) {
    return classifyGitError(err)
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
