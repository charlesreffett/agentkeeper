import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptSkill, listSkills, reconcileSkillLinks, removeSkill } from './skills'
import { harnessRegistry } from './harness/index'

const temporaryRoots: string[] = []

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentkeeper-skills-'))
  temporaryRoots.push(root)
  return root
}

async function createSkill(root: string, id: string, body = '# Skill'): Promise<string> {
  const skill = path.join(root, id)
  await fs.mkdir(skill, { recursive: true })
  await fs.writeFile(path.join(skill, 'SKILL.md'), `---\nname: ${id}\ndescription: Test\n---\n\n${body}\n`)
  return skill
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('managed skill compatibility links', () => {
  it('registers canonical and harness-native project roots accurately', async () => {
    const root = await temporaryRoot()
    const locations = Object.fromEntries(harnessRegistry.list().map((harness) => [
      harness.id,
      harness.getSkillLocations('project', root),
    ]))

    expect(locations['claude-code']).toEqual([
      { path: path.join(root, '.claude', 'skills'), kind: 'native' },
    ])
    expect(locations['codex']).toEqual([
      { path: path.join(root, '.agents', 'skills'), kind: 'native', canonical: true },
    ])
    expect(locations['opencode']).toEqual(expect.arrayContaining([
      { path: path.join(root, '.opencode', 'skills'), kind: 'native' },
      { path: path.join(root, '.agents', 'skills'), kind: 'compatible', canonical: true },
    ]))
    expect(locations['cursor']).toEqual(expect.arrayContaining([
      { path: path.join(root, '.cursor', 'skills'), kind: 'native' },
      { path: path.join(root, '.agents', 'skills'), kind: 'compatible', canonical: true },
    ]))
    expect(locations['grok']).toEqual([
      { path: path.join(root, '.grok', 'skills'), kind: 'native' },
      { path: path.join(root, '.claude', 'skills'), kind: 'compatible' },
    ])
  })

  it('creates per-skill links without replacing the native root', async () => {
    const root = await temporaryRoot()
    const canonical = await createSkill(path.join(root, '.agents', 'skills'), 'review')
    const claudeRoot = path.join(root, '.claude', 'skills')

    expect(await reconcileSkillLinks(canonical, [claudeRoot])).toEqual([
      { path: path.join(claudeRoot, 'review'), status: 'created' },
    ])
    expect(await fs.realpath(path.join(claudeRoot, 'review'))).toBe(await fs.realpath(canonical))
    expect((await fs.lstat(claudeRoot)).isDirectory()).toBe(true)
  })

  it('is idempotent for an existing link to the canonical skill', async () => {
    const root = await temporaryRoot()
    const canonical = await createSkill(path.join(root, '.agents', 'skills'), 'review')
    const claudeRoot = path.join(root, '.claude', 'skills')
    await reconcileSkillLinks(canonical, [claudeRoot])

    expect(await reconcileSkillLinks(canonical, [claudeRoot])).toEqual([
      { path: path.join(claudeRoot, 'review'), status: 'linked' },
    ])
  })

  it('preserves a different harness-specific skill with the same id', async () => {
    const root = await temporaryRoot()
    const canonical = await createSkill(path.join(root, '.agents', 'skills'), 'review', '# Canonical')
    const claudeRoot = path.join(root, '.claude', 'skills')
    const existing = await createSkill(claudeRoot, 'review', '# Claude-specific')

    expect(await reconcileSkillLinks(canonical, [claudeRoot])).toEqual([
      { path: existing, status: 'conflict' },
    ])
    expect(await fs.readFile(path.join(existing, 'SKILL.md'), 'utf8')).toContain('# Claude-specific')
  })

  it('creates independent links for every required harness root', async () => {
    const root = await temporaryRoot()
    const canonical = await createSkill(path.join(root, '.agents', 'skills'), 'review')
    const targets = [path.join(root, '.claude', 'skills'), path.join(root, '.grok', 'skills')]

    const results = await reconcileSkillLinks(canonical, targets)
    expect(results.map((result) => result.status)).toEqual(['created', 'created'])
    await Promise.all(targets.map(async (target) => {
      expect(await fs.realpath(path.join(target, 'review'))).toBe(await fs.realpath(canonical))
    }))
  })

  it('discovers and manages an existing harness-specific skill', async () => {
    const root = await temporaryRoot()
    const existing = await createSkill(path.join(root, '.claude', 'skills'), 'legacy')

    const skills = (await listSkills(root)).filter((skill) => skill.scope === 'project')
    expect(skills).toContainEqual(expect.objectContaining({
      id: 'legacy',
      path: await fs.realpath(existing),
      projectPath: root,
      managed: false,
      conflict: false,
    }))
    expect(skills.find((skill) => skill.id === 'legacy')?.harnessIds).toEqual(
      expect.arrayContaining(['claude-code', 'opencode', 'cursor', 'grok']),
    )
  })

  it('adopts an existing skill into the canonical store and keeps a backup', async () => {
    const root = await temporaryRoot()
    const original = await createSkill(path.join(root, '.claude', 'skills'), 'legacy')
    const before = (await listSkills(root)).find((skill) => skill.scope === 'project' && skill.id === 'legacy')!
    const appData = path.join(root, 'app-data')

    await adoptSkill(root, before, appData)

    const canonical = path.join(root, '.agents', 'skills', 'legacy')
    expect(await fs.realpath(original)).toBe(await fs.realpath(canonical))
    const after = (await listSkills(root)).find((skill) => skill.scope === 'project' && skill.id === 'legacy')!
    expect(after.managed).toBe(true)
    const backupRoot = path.join(appData, 'skill-backups', 'project')
    const backupRuns = await fs.readdir(backupRoot)
    expect(backupRuns).toHaveLength(1)
    await fs.access(path.join(backupRoot, backupRuns[0]!, 'legacy', 'SKILL.md'))

    await removeSkill(root, after)
    await expect(fs.access(canonical)).rejects.toThrow()
    await expect(fs.lstat(original)).rejects.toThrow()
  })

  it('keeps different harness-specific versions and marks the collision', async () => {
    const root = await temporaryRoot()
    await createSkill(path.join(root, '.claude', 'skills'), 'review', '# Claude')
    await createSkill(path.join(root, '.grok', 'skills'), 'review', '# Grok')

    const matches = (await listSkills(root)).filter((skill) => skill.scope === 'project' && skill.id === 'review')
    expect(matches).toHaveLength(2)
    expect(matches.every((skill) => skill.conflict)).toBe(true)
    expect(matches.map((skill) => skill.body.trim()).sort()).toEqual(['# Claude', '# Grok'])
  })
})
