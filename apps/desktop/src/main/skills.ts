import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import Anthropic from '@anthropic-ai/sdk'
import type { Skill, SkillPreview } from '../shared/ipc-contract'
import { resolveClaudeAuth } from './secrets'
import { getHarness } from './harness/index'

const execFileAsync = promisify(execFile)

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
    // npm writes warnings to stderr even on success; filter them out so they
    // don't mask the actual error (which lands on stdout).
    const meaningfulStderr = (e.stderr ?? '')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('npm warn'))
      .join('\n')
      .trim()
    const raw = meaningfulStderr || e.stdout?.trim() || e.message || ''
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
    getHarness().getSkillsDir(scope, projectPath)
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

/**
 * If `url` is a GitHub tree URL whose ref segment is a bare 40-character
 * commit SHA, rewrite it to use the repository's default branch instead.
 *
 * Why: `git clone --branch <ref>` only accepts branch names and tags — not
 * arbitrary commit SHAs — so the `npx skills` CLI fails when given a GitHub
 * permalink like `.../tree/a05d923c.../plugins/foo`. We resolve the default
 * branch via `git ls-remote`, then verify the subpath still exists there
 * (since the tree may have diverged from the pinned commit).
 */
async function resolveGithubShaUrl(url: string): Promise<string> {
  const m =
    /^(https?:\/\/github\.com\/([^/]+)\/([^/]+))\/tree\/([0-9a-f]{40})(\/[^?#]*)?/i.exec(url)
  if (!m) return url

  const repoBase = m[1]!
  const owner = m[2]!
  const repo = m[3]!
  const sha = m[4]!
  const subpath = m[5] ?? ''
  const gitUrl = `${repoBase}.git`

  let branch: string
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', '--symref', gitUrl, 'HEAD'], {
      timeout: 15000,
    })
    const bm = /^ref: refs\/heads\/([^\t\n\r]+)\tHEAD/m.exec(stdout)
    branch = bm ? bm[1]! : 'main'
  } catch {
    throw new Error(
      `Could not contact ${owner}/${repo} to resolve the commit SHA — check your network connection.`,
    )
  }

  let resolvedSubpath = subpath
  const cleanPath = subpath.replace(/^\//, '')
  if (cleanPath) {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${cleanPath}?ref=${branch}`
    try {
      const resp = await fetch(apiUrl, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        signal: AbortSignal.timeout(10000),
      })
      if (resp.status === 404) {
        throw new Error(
          `"${cleanPath}" no longer exists on the "${branch}" branch of ${owner}/${repo}. ` +
            `The repository may have changed since this link was created (${sha.slice(0, 7)}).`,
        )
      }
      // If the path is a directory that contains a skills/ subdirectory, redirect
      // into it — the npx skills CLI expects SKILL.md files one level below the
      // source path, so plugin-style repos (skills/<name>/SKILL.md) need this.
      if (resp.ok) {
        const data = (await resp.json()) as unknown
        if (Array.isArray(data)) {
          const hasSkillsDir = (data as Array<{ name: string; type: string }>).some(
            (item) => item.name === 'skills' && item.type === 'dir',
          )
          if (hasSkillsDir) {
            resolvedSubpath = `${subpath}/skills`
            console.log('[skills] detected skills/ subdirectory, redirecting into it')
          }
        }
      }
    } catch (e) {
      if ((e as Error).message.includes('no longer exists')) throw e
      // Network failure during validation — let the CLI attempt it and surface its own error
    }
  }

  const rewritten = `${repoBase}/tree/${branch}${resolvedSubpath}`
  console.log('[skills] rewrote SHA permalink', {
    sha: sha.slice(0, 7),
    branch,
    rewritten,
  })
  return rewritten
}

/**
 * Normalise whatever the user pastes into the source field. Accepts either a
 * bare source (URL, GitHub shorthand, npm package) or a full terminal command
 * like `npx skills add https://github.com/foo/bar --skill tailwindcss -g`.
 * Strips the command prefix, known standalone flags, and -a/--agent overrides,
 * then returns the clean source together with any --skill/-s values found.
 */
function parseSourceInput(raw: string): { source: string; skillFilter: string[] } {
  let input = raw.trim()

  // Strip leading `npx [--yes|-y] skills add ` prefix
  input = input.replace(/^npx\s+(?:--yes\s+|-y\s+)?skills\s+add\s+/i, '')

  // Collect --skill / -s values and remove them from the string
  const skillFilter: string[] = []
  input = input.replace(/(?:--skill|-s)\s+(\S+)/g, (_, name: string) => {
    skillFilter.push(name)
    return ''
  })

  // Strip flags we always control ourselves so they don't appear twice
  const dropFlags = ['-g', '--global', '-y', '--yes', '--full-depth', '-l', '--list']
  for (const flag of dropFlags) {
    const escaped = flag.replace(/[-]/g, '\\$&')
    input = input.replace(new RegExp(`\\s*${escaped}(?=\\s|$)`, 'g'), '')
  }

  // Strip -a/--agent <value> — we always inject -a <harness-id> ourselves
  input = input.replace(/(?:-a|--agent)\s+\S+/g, '')

  return { source: input.trim(), skillFilter }
}

export async function previewSkills(
  projectPath: string,
  source: string,
): Promise<SkillPreview[]> {
  const { source: cleanSource, skillFilter } = parseSourceInput(source)
  const resolvedSource = await resolveGithubShaUrl(cleanSource)
  const { stdout } = await runSkills(
    ['add', resolvedSource, '-a', getHarness().id, '-l', '-y'],
    projectPath,
  )
  let previews = parsePreviewOutput(stdout)
  if (skillFilter.length > 0) {
    const normalized = skillFilter.map((s) => s.toLowerCase())
    previews = previews.filter((p) =>
      normalized.some((f) => p.id.toLowerCase() === f || p.name.toLowerCase() === f),
    )
  }
  return previews
}

export async function installSkill(
  projectPath: string,
  source: string,
  scope: 'project' | 'global',
  skillIds?: string[],
): Promise<void> {
  const { source: cleanSource, skillFilter } = parseSourceInput(source)
  const resolvedSource = await resolveGithubShaUrl(cleanSource)
  const cwd = scope === 'global' ? os.homedir() : projectPath
  // Merge skill IDs from the source string with any explicitly chosen in the UI
  const mergedIds = [
    ...(skillIds ?? []),
    ...skillFilter.filter((f) => !(skillIds ?? []).includes(f)),
  ]
  const args: string[] = ['add', resolvedSource, '-a', getHarness().id, '-y']
  if (scope === 'global') args.push('-g')
  if (mergedIds.length > 0) {
    for (const id of mergedIds) {
      args.push('-s', id)
    }
  } else {
    args.push('-s', '*')
  }
  console.log('[skills] installSkill', {
    source: cleanSource,
    scope,
    cwd,
    selectedCount: mergedIds.length,
    selected: mergedIds.length > 0 ? mergedIds : '(all: -s *)',
    args,
  })
  await runSkills(args, cwd)
}

export async function removeSkill(skill: Skill): Promise<void> {
  await fs.rm(skill.path, { recursive: true, force: true })
}

const SKILL_GENERATION_SYSTEM = `You generate agent skill files. Output ONLY the skill markdown starting with \`---\`. No explanation, no code fences, no prose before or after.

Format:
---
name: <kebab-case-id>
description: <one-line description of what this skill does>
---

# Title

Instructions to Claude...`

function validateGeneratedSkill(raw: string): string {
  const text = stripAnsi(raw).trim()
  if (!text.startsWith('---')) {
    throw new Error('Generation returned unexpected format — try rephrasing the prompt.')
  }
  return text
}

export async function generateSkillContent(prompt: string): Promise<string> {
  const auth = await resolveClaudeAuth()
  const userContent = `Create an agent skill that does the following: ${prompt}`

  if (auth.type === 'api-key') {
    const client = new Anthropic({ apiKey: auth.key })
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SKILL_GENERATION_SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    })
    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    return validateGeneratedSkill(text)
  }

  // Pro/Max plan path — harness CLI picks up `claude login` credentials
  const fullPrompt = `${SKILL_GENERATION_SYSTEM}\n\n${userContent}`
  try {
    const stdout = await getHarness().runPrompt(fullPrompt, { cwd: os.homedir() })
    return validateGeneratedSkill(stdout)
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string }
    if (e.code === 'ENOENT') {
      throw new Error('CLI not found in PATH — make sure the agent harness is installed.')
    }
    const raw = e.stderr?.trim() || e.stdout?.trim() || e.message || 'unknown error'
    throw new Error(`Skill generation failed: ${stripAnsi(raw).trim()}`)
  }
}

export async function saveSkill(
  projectPath: string,
  id: string,
  scope: 'project' | 'global',
  content: string,
): Promise<Skill> {
  const dir = getHarness().getSkillsDir(scope, projectPath)
  if (!dir) throw new Error(`The '${getHarness().name}' harness has no skills directory.`)
  const skillDir = path.join(dir, id)
  const skillFile = path.join(skillDir, 'SKILL.md')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(skillFile, content.trimEnd() + '\n', 'utf8')
  const { name, description, body } = parseFrontmatter(content)
  return { id, scope, path: skillDir, name: name || id, description, body }
}
