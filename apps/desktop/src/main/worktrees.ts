import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import fs from 'node:fs/promises'
import type { WorktreeInfo } from '../shared/ipc-contract'

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

export async function createWorktree(
  projectPath: string,
  opts: CreateWorktreeOptions,
): Promise<WorktreeInfo> {
  await ensureGitRepo(projectPath)
  const branch = sanitizeBranch(opts.branchRequest)
  const rootDir = worktreesRoot(projectPath)
  const wtPath = path.join(rootDir, branch)

  await fs.mkdir(rootDir, { recursive: true })

  if (await pathExists(wtPath)) {
    throw new Error(`A worktree already exists at ${wtPath}`)
  }

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
