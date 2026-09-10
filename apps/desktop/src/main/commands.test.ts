import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SlashCommand } from '../shared/ipc-contract'
import { reconcileCommandLinks, resolveCommand } from './commands'

const temporary: string[] = []
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))) })

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentkeeper-commands-')); temporary.push(root)
  const canonical = path.join(root, '.agents', 'commands', 'review.md')
  await fs.mkdir(path.dirname(canonical), { recursive: true }); await fs.writeFile(canonical, '# Review\n')
  return { root, canonical, native: path.join(root, '.claude', 'commands') }
}

function command(patch: Partial<SlashCommand> = {}): SlashCommand {
  return { id: 'review', scope: 'project', projectPath: '/project', path: '/one', locations: ['/one'], harnessIds: [], shared: false, conflict: false, name: 'Review', body: '# Review', ...patch }
}

describe('managed commands', () => {
  it('creates a relative per-file link and reconciles idempotently', async () => {
    const { canonical, native } = await fixture()
    expect(await reconcileCommandLinks(canonical, [native])).toMatchObject([{ status: 'created' }])
    expect(await fs.readlink(path.join(native, 'review.md'))).not.toMatch(/^\//)
    expect(await reconcileCommandLinks(canonical, [native])).toMatchObject([{ status: 'linked' }])
  })

  it('preserves files and broken links as conflicts', async () => {
    const first = await fixture(); await fs.mkdir(first.native, { recursive: true }); await fs.writeFile(path.join(first.native, 'review.md'), 'local')
    expect(await reconcileCommandLinks(first.canonical, [first.native])).toMatchObject([{ status: 'conflict' }])
    const second = await fixture(); await fs.mkdir(second.native, { recursive: true }); await fs.symlink('missing.md', path.join(second.native, 'review.md'))
    expect(await reconcileCommandLinks(second.canonical, [second.native])).toMatchObject([{ status: 'conflict' }])
  })

  it('uses project then shared precedence and rejects ambiguous native commands', () => {
    expect(resolveCommand([command({ scope: 'global', path: '/global' }), command({ shared: true, path: '/shared' })], 'review')?.path).toBe('/shared')
    expect(() => resolveCommand([command(), command({ path: '/two' })], 'review')).toThrow(/ambiguous/)
  })
})
