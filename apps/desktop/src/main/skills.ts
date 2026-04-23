import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Skill, SkillPreview } from '../shared/ipc-contract'

const execFileAsync = promisify(execFile)

const PROJECT_SKILLS_DIR = '.claude/skills'
const GLOBAL_SKILLS_DIR = '.claude/skills'

function projectSkillsDir(projectPath: string): string {
  return path.join(projectPath, PROJECT_SKILLS_DIR)
}

function globalSkillsDir(): string {
  return path.join(os.homedir(), GLOBAL_SKILLS_DIR)
}

function parseFrontmatter(source: string): { name: string; description: string; body: string } {
  const trimmed = source.replace(/^﻿/, '')
  if (trimmed.startsWith('---')) {
    const end = trimmed.indexOf('\n---', 3)
    if (end !== -1) {
      const fm = trimmed.slice(3, end)
      const body = trimmed.slice(end + 4).replace(/^\r?\n/, '').trimEnd()
      const nameMatch = fm.match(/^name:\s*(.+)$/m)
      const descMatch = fm.match(/^description:\s*(.+)$/m)
      return {
        name: nameMatch ? nameMatch[1]!.trim() : '',
        description: descMatch ? descMatch[1]!.trim() : '',
        body,
      }
    }
  }
  return { name: '', description: '', body: trimmed.trimEnd() }
}

function normalizeSource(source: string): string {
  if (/^[\w.-]+\/[\w.-]+$/.test(source)) {
    return `https://github.com/${source}`
  }
  return source
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

function parsePreviewOutput(stdout: string): SkillPreview[] {
  const lines = stripAnsi(stdout).split('\n')

  const structured: SkillPreview[] = []
  // "  - id" or "  - id: description"
  const dashRe = /^\s*-\s+([\w.-]+)(?:\s*:\s*(.+))?$/
  // "  id: description"
  const colonRe = /^\s*([\w.-]+):\s+(.+)$/
  // "  ✓ name" or "  • name" etc.
  const bulletRe = /^\s*[✓✗✔●•*]\s+(.+)$/

  for (const line of lines) {
    const m1 = dashRe.exec(line)
    if (m1) {
      structured.push({ id: m1[1]!, name: m1[1]!, description: m1[2]?.trim() ?? '' })
      continue
    }
    const m2 = colonRe.exec(line)
    if (m2) {
      structured.push({ id: m2[1]!, name: m2[1]!, description: m2[2]!.trim() })
      continue
    }
    const m3 = bulletRe.exec(line)
    if (m3) {
      const name = m3[1]!.trim()
      structured.push({
        id: name.toLowerCase().replace(/\s+/g, '-'),
        name,
        description: '',
      })
    }
  }

  if (structured.length > 0) return structured

  // Fall back: raw non-empty, non-header lines
  return lines
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length > 0 &&
        !l.endsWith(':') &&
        !/^(available|skills|installing|preview|selecting|fetching|cloning)/i.test(l),
    )
    .map((l) => ({ id: l, name: l, description: '' }))
}

async function listScope(
  scope: 'project' | 'global',
  projectPath: string,
): Promise<Skill[]> {
  const dir = scope === 'project' ? projectSkillsDir(projectPath) : globalSkillsDir()
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const results: Skill[] = []
  for (const entry of entries) {
    const skillDir = path.join(dir, entry)
    const skillFile = path.join(skillDir, 'SKILL.md')
    try {
      const stat = await fs.stat(skillDir)
      if (!stat.isDirectory()) continue
      const content = await fs.readFile(skillFile, 'utf8')
      const { name, description, body } = parseFrontmatter(content)
      results.push({
        id: entry,
        scope,
        path: skillDir,
        name: name || entry,
        description,
        body,
      })
    } catch {
      // skip missing/unreadable skill dirs
    }
  }
  return results
}

export async function listSkills(projectPath: string): Promise<Skill[]> {
  const [project, global] = await Promise.all([
    listScope('project', projectPath),
    listScope('global', projectPath),
  ])
  return [...project, ...global]
}

export async function previewSkills(
  projectPath: string,
  source: string,
): Promise<SkillPreview[]> {
  const normalized = normalizeSource(source)
  try {
    const { stdout } = await execFileAsync(
      'npx',
      ['--yes', 'skills', 'add', normalized, '--list', '--yes'],
      { cwd: projectPath, timeout: 30000 },
    )
    return parsePreviewOutput(stdout)
  } catch {
    return []
  }
}

export async function installSkill(
  projectPath: string,
  source: string,
  scope: 'project' | 'global',
  skillIds?: string[],
): Promise<void> {
  const normalized = normalizeSource(source)
  const args: string[] = ['--yes', 'skills', 'add']
  if (scope === 'global') args.push('-g')
  args.push(normalized)
  if (skillIds && skillIds.length > 0) {
    for (const id of skillIds) {
      args.push('--skill', id)
    }
  } else {
    args.push('--all')
  }
  const cwd = scope === 'global' ? os.homedir() : projectPath
  await execFileAsync('npx', args, { cwd, timeout: 60000 }).catch((err) => {
    throw new Error(
      (err as NodeJS.ErrnoException & { stderr?: string }).stderr?.trim() ||
        err.message,
    )
  })
}

export async function removeSkill(skill: Skill): Promise<void> {
  await fs.rm(skill.path, { recursive: true, force: true })
}
