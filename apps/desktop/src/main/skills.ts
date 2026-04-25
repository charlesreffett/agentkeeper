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

function parseFrontmatter(source: string): {
  name: string
  description: string
  body: string
} {
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

/**
 * Strip ANSI / terminal control sequences so we can parse decorated CLI
 * output. The previous version only matched color CSIs (`\x1b[...m`), which
 * let cursor moves ([999D), erase ([J, [K), and mode-toggles ([?25l, [?25h)
 * leak through — and those were the reason the "preview" treated progress
 * frames as skills. This version matches any CSI (final byte in @-~) plus
 * OSC and single-char escapes.
 */
function stripAnsi(s: string): string {
  return s
    // CSI: ESC [ <params> <intermediates> <final 0x40-0x7E>
    .replace(/\x1b\[[\d;?>=!]*[@-~]/g, '')
    // OSC: ESC ] ... BEL or ST
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    // Single-char escape sequences (ESC + one letter)
    .replace(/\x1b[A-Za-z=>]/g, '')
}

async function runSkills(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = ['--yes', 'skills', ...args]
  const cmdline = `npx ${fullArgs.join(' ')}`
  const startedAt = Date.now()
  console.log('[skills] exec', { cmdline, cwd })
  try {
    const result = await execFileAsync('npx', fullArgs, {
      cwd,
      timeout: 90000,
      maxBuffer: 10 * 1024 * 1024,
    })
    console.log('[skills] exec ok', {
      cmdline,
      ms: Date.now() - startedAt,
      stdoutBytes: result.stdout.length,
      stderrBytes: result.stderr.length,
    })
    return result
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      code?: string | number
      signal?: string
    }
    const raw = (e.stderr?.trim() || e.stdout?.trim() || e.message) ?? ''
    console.error('[skills] exec failed', {
      cmdline,
      cwd,
      ms: Date.now() - startedAt,
      code: e.code,
      signal: e.signal,
      stdout: e.stdout,
      stderr: e.stderr,
      message: e.message,
    })
    throw new Error(`skills CLI failed: ${stripAnsi(raw).trim()}`)
  }
}

/**
 * Parse the output of `npx skills add <source> -l -y`.
 *
 * Observed format (stripped of ANSI):
 *
 *     Found 18 skills
 *
 *     ◇  Available Skills
 *     Claude Api
 *     │
 *     │    claude-api
 *     │
 *     │      Build, debug, and optimize Claude API ...
 *
 *     Document Skills
 *     │
 *     │    docx
 *     │
 *     │      Use this skill ...
 *     ...
 *     └   Use --skill <name> to install specific skills
 *
 * Group headers are flush-left, skill ids are "│ " + 4 spaces + slug,
 * descriptions are "│ " + 6+ spaces + text, terminated by the outro marker.
 */
function parsePreviewOutput(raw: string): SkillPreview[] {
  const clean = stripAnsi(raw)
  const lines = clean.split('\n')

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (/Available Skills/.test(lines[i]!)) {
      start = i + 1
      break
    }
  }
  if (start === -1) {
    for (let i = 0; i < lines.length; i++) {
      if (/Found \d+ skills?/.test(lines[i]!)) {
        start = i + 1
        break
      }
    }
  }
  if (start === -1) return []

  const idRegex = /^(?:│|\|) {2,5}([a-z][a-z0-9_-]*)\s*$/
  const descRegex = /^(?:│|\|) {4,}(\S.*)$/
  const outroRegex = /^(?:└|\\)\s+Use --skill/

  const previews: SkillPreview[] = []
  const seen = new Set<string>()

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    if (outroRegex.test(line)) break

    const idMatch = idRegex.exec(line)
    if (!idMatch) continue

    const id = idMatch[1]!
    if (seen.has(id)) continue

    let description = ''
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const nextLine = lines[j]!
      if (/^(?:│|\|)\s*$/.test(nextLine)) continue
      if (idRegex.test(nextLine)) break
      const descMatch = descRegex.exec(nextLine)
      if (descMatch) {
        description = descMatch[1]!.trim()
        break
      }
      break
    }

    previews.push({ id, name: id, description })
    seen.add(id)
  }

  return previews
}

async function listScope(
  scope: 'project' | 'global',
  projectPath: string,
): Promise<Skill[]> {
  const dir =
    scope === 'project' ? projectSkillsDir(projectPath) : globalSkillsDir()
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
    projectPath ? listScope('project', projectPath) : Promise.resolve([]),
    listScope('global', projectPath),
  ])
  return [...project, ...global]
}

export async function previewSkills(
  projectPath: string,
  source: string,
): Promise<SkillPreview[]> {
  const { stdout } = await runSkills(
    ['add', source, '-a', 'claude-code', '-l', '-y'],
    projectPath,
  )
  return parsePreviewOutput(stdout)
}

export async function installSkill(
  projectPath: string,
  source: string,
  scope: 'project' | 'global',
  skillIds?: string[],
): Promise<void> {
  const cwd = scope === 'global' ? os.homedir() : projectPath
  const args: string[] = ['add', source, '-a', 'claude-code', '-y']
  if (scope === 'global') args.push('-g')
  if (skillIds && skillIds.length > 0) {
    for (const id of skillIds) {
      args.push('-s', id)
    }
  } else {
    args.push('-s', '*')
  }
  console.log('[skills] installSkill', {
    source,
    scope,
    cwd,
    selectedCount: skillIds?.length ?? 0,
    selected: skillIds ?? '(all: -s *)',
    args,
  })
  await runSkills(args, cwd)
}

export async function removeSkill(skill: Skill): Promise<void> {
  await fs.rm(skill.path, { recursive: true, force: true })
}
