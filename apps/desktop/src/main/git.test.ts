import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { switchBranch } from './git'

const execFileAsync = promisify(execFile)
let repo = ''

beforeEach(async () => {
  repo = await mkdtemp(path.join(os.tmpdir(), 'agentkeeper-git-test-'))
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: repo })
  await writeFile(path.join(repo, 'tracked.txt'), 'initial\n')
  await execFileAsync('git', ['add', 'tracked.txt'], { cwd: repo })
  await execFileAsync('git', ['commit', '-m', 'initial'], { cwd: repo })
  await execFileAsync('git', ['branch', 'other'], { cwd: repo })
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe('switchBranch', () => {
  it('treats the current branch as a no-op even with tracked edits', async () => {
    await writeFile(path.join(repo, 'tracked.txt'), 'edited\n')

    await expect(switchBranch(repo, 'main')).resolves.toEqual({ ok: true })
    await expect(readFile(path.join(repo, 'tracked.txt'), 'utf8')).resolves.toBe('edited\n')
  })

  it('still blocks switching to another branch with tracked edits', async () => {
    await writeFile(path.join(repo, 'tracked.txt'), 'edited\n')

    await expect(switchBranch(repo, 'other')).resolves.toEqual({ ok: false, blocked: 'dirty' })
  })

  it('allows switching branches when changes are untracked only', async () => {
    await writeFile(path.join(repo, 'untracked.txt'), 'keep me\n')

    await expect(switchBranch(repo, 'other')).resolves.toEqual({ ok: true })
    await expect(readFile(path.join(repo, 'untracked.txt'), 'utf8')).resolves.toBe('keep me\n')
  })
})
