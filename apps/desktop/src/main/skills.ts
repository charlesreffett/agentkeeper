import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Skill } from '../shared/ipc-contract'

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

export async function installSkill(
  projectPath: string,
  source: string,
  scope: 'project' | 'global',
): Promise<void> {
  const args = scope === 'global'
    ? ['skills', 'add', '-g', source]
    : ['skills', 'add', source]
  const cwd = scope === 'global' ? os.homedir() : projectPath
  const { stderr } = await execFileAsync('npx', args, { cwd }).catch((err) => {
    throw new Error(
      (err as NodeJS.ErrnoException & { stderr?: string }).stderr?.trim() ||
        err.message,
    )
  })
  if (stderr) {
    const cleaned = stderr.trim()
    if (cleaned) console.warn('[skills:install]', cleaned)
  }
}

export async function removeSkill(skill: Skill): Promise<void> {
  await fs.rm(skill.path, { recursive: true, force: true })
}
