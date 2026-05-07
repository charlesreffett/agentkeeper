import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { GitDiffStatFile, WorktreeInfo } from '../shared/ipc-contract'

const exec = promisify(execFile)

/**
 * Sanitize a free-form name into a valid git branch segment.
 * Lowercase, hyphens for whitespace/underscores, stripped of
 * disallowed characters, capped at 80 chars. Falls back to "job".
 */
export function sanitizeBranch(name: string): string {
  const clean = name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9./-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 80)
  return clean || 'job'
}

/**
 * Worktree root: `<projectPath>--worktrees/`.
 * Matches the convention Claude Code uses when users create worktrees
 * alongside a project (visible in ~/.claude/projects/ encoded dirs).
 */
function worktreesRoot(projectPath: string): string {
  return `${projectPath}--worktrees`
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  })
  return stdout
}

async function ensureGitRepo(projectPath: string): Promise<void> {
  try {
    await git(projectPath, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    throw new Error(`${projectPath} is not a git repository`)
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export interface CreateWorktreeOptions {
  branchRequest: string
}

async function branchExists(projectPath: string, branch: string): Promise<boolean> {
  try {
    await git(projectPath, ['rev-parse', '--verify', `refs/heads/${branch}`])
    return true
  } catch {
    return false
  }
}

/**
 * Find a branch name derived from `base` that has neither a worktree on
 * disk nor an existing ref in the repo. Returns { branch, path } ready for
 * `git worktree add -b`.
 */
async function findFreeBranch(
  projectPath: string,
  rootDir: string,
  base: string,
): Promise<{ branch: string; wtPath: string }> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`
    const wtPath = path.join(rootDir, candidate)
    const pathTaken = await pathExists(wtPath)
    const refTaken = await branchExists(projectPath, candidate)
    if (!pathTaken && !refTaken) {
      return { branch: candidate, wtPath }
    }
  }
  throw new Error(`Exhausted search for a free branch name starting with "${base}".`)
}

export async function createWorktree(
  projectPath: string,
  opts: CreateWorktreeOptions,
): Promise<WorktreeInfo> {
  await ensureGitRepo(projectPath)
  const base = sanitizeBranch(opts.branchRequest)
  const rootDir = worktreesRoot(projectPath)

  await fs.mkdir(rootDir, { recursive: true })

  const { branch, wtPath } = await findFreeBranch(projectPath, rootDir, base)

  try {
    await git(projectPath, ['worktree', 'add', '-b', branch, wtPath])
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`git worktree add failed: ${message}`)
  }

  const head = (await git(wtPath, ['rev-parse', 'HEAD'])).trim()
  return { path: wtPath, branch, head }
}

export async function listWorktrees(
  projectPath: string,
): Promise<WorktreeInfo[]> {
  try {
    await ensureGitRepo(projectPath)
  } catch {
    return []
  }
  const out = await git(projectPath, ['worktree', 'list', '--porcelain'])
  const blocks = out.split(/\n\n+/).filter((b) => b.trim().length > 0)
  const result: WorktreeInfo[] = []
  for (const block of blocks) {
    const kv: Record<string, string> = {}
    for (const line of block.split('\n')) {
      const [key, ...rest] = line.split(' ')
      if (key) kv[key] = rest.join(' ')
    }
    const wtPath = kv['worktree']
    if (!wtPath) continue
    result.push({
      path: wtPath,
      branch: (kv['branch'] ?? '').replace(/^refs\/heads\//, ''),
      head: kv['HEAD'] ?? '',
    })
  }
  return result
}

export async function removeWorktree(
  projectPath: string,
  worktreePath: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const args = ['worktree', 'remove']
  if (options.force) args.push('--force')
  args.push(worktreePath)
  await git(projectPath, args)
}

function parseNumstat(output: string): GitDiffStatFile[] {
  const result: GitDiffStatFile[] = []
  for (const line of output.trim().split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 3) continue
    // Binary files show '-' instead of numbers — treat as 0
    const added = parseInt(parts[0] ?? '-', 10)
    const removed = parseInt(parts[1] ?? '-', 10)
    const file = parts[2] ?? ''
    if (!file) continue
    result.push({
      file,
      added: Number.isNaN(added) ? 0 : added,
      removed: Number.isNaN(removed) ? 0 : removed,
    })
  }
  return result
}

/**
 * Returns per-file diff stats (added/removed line counts) between HEAD and
 * a base ref. When no `baseBranch` is given, tries to find the merge-base
 * with the remote default branch so the diff covers only the worktree's own
 * changes since it branched off.
 */
export async function gitDiffStat(
  worktreePath: string,
  baseBranch?: string,
): Promise<GitDiffStatFile[]> {
  let base: string

  if (baseBranch) {
    base = baseBranch
  } else {
    // Try common remote default-branch names in order.
    const candidates = ['origin/HEAD', 'origin/main', 'origin/master']
    let mergeBase: string | null = null
    for (const candidate of candidates) {
      try {
        const out = await git(worktreePath, ['merge-base', 'HEAD', candidate])
        mergeBase = out.trim()
        break
      } catch {
        // try next candidate
      }
    }
    base = mergeBase ?? 'HEAD'
  }

  const args =
    base === 'HEAD'
      ? ['diff', '--numstat']
      : ['diff', '--numstat', `${base}..HEAD`]

  const output = await git(worktreePath, args)
  return parseNumstat(output)
}
