import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import type { Skill, SkillPreview } from '../shared/ipc-contract'
import { getHarness, harnessRegistry } from './harness/index'

const execFileAsync = promisify(execFile)
// The skills CLI's hidden universal target uses `.agents/skills` for both
// project and global installs. Harness-specific targets diverge globally.
const MANAGED_SKILLS_INSTALL_AGENT = 'universal'

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

function canonicalSkillsDir(scope: 'project' | 'global', projectPath: string): string {
  return scope === 'project'
    ? path.join(projectPath, '.agents', 'skills')
    : path.join(os.homedir(), '.agents', 'skills')
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

type SkillRoot = { path: string; harnessIds: Set<string> }

function skillRoots(scope: 'project' | 'global', projectPath: string): SkillRoot[] {
  const roots = new Map<string, SkillRoot>()
  const canonical = canonicalSkillsDir(scope, projectPath)
  for (const harness of harnessRegistry.list()) {
    if (!harness.capabilities.skills) continue
    for (const location of harness.getSkillLocations(scope, projectPath)) {
      const normalized = path.resolve(location.path)
      const existing = roots.get(normalized) ?? {
        path: normalized,
        harnessIds: new Set<string>(),
      }
      existing.harnessIds.add(harness.id)
      roots.set(normalized, existing)
    }
  }
  // The canonical store remains manageable even when no installed adapter is
  // currently available.
  if (!roots.has(path.resolve(canonical))) {
    roots.set(path.resolve(canonical), {
      path: path.resolve(canonical), harnessIds: new Set(),
    })
  }
  return [...roots.values()]
}

const availabilityCache = new Map<string, { expires: number; available: boolean }>()
const availabilityInflight = new Map<string, Promise<boolean>>()

async function skillHarnessAvailable(harness: ReturnType<typeof harnessRegistry.list>[number]): Promise<boolean> {
  const cached = availabilityCache.get(harness.id)
  if (cached && cached.expires > Date.now()) return cached.available
  const pending = availabilityInflight.get(harness.id)
  if (pending) return pending
  const probe = (async () => {
    let available = false
    try { available = (await harness.probeAvailability()).available } catch { /* unavailable */ }
    availabilityCache.set(harness.id, { available, expires: Date.now() + 30_000 })
    return available
  })()
  availabilityInflight.set(harness.id, probe)
  try { return await probe } finally { availabilityInflight.delete(harness.id) }
}

async function installedSkillHarnesses() {
  return (await Promise.all(harnessRegistry.list().map(async (harness) => {
    if (!harness.capabilities.skills) return null
    return await skillHarnessAvailable(harness) ? harness : null
  }))).filter((harness): harness is NonNullable<typeof harness> => harness !== null)
}

export type SkillLinkResult = { path: string; status: 'created' | 'linked' | 'conflict' }

/** Link one canonical skill into native roots for installed harnesses that do
 * not discover `.agents/skills` at this scope. Existing entries are never
 * replaced. Exported for filesystem-level tests. */
export async function reconcileSkillLinks(
  canonicalSkillDir: string,
  nativeTargets: string[],
): Promise<SkillLinkResult[]> {
  const results: SkillLinkResult[] = []
  const physicalCanonical = await fs.realpath(canonicalSkillDir)
  for (const root of new Set(nativeTargets.map((target) => path.resolve(target)))) {
    const destination = path.join(root, path.basename(canonicalSkillDir))
    try {
      const resolved = await fs.realpath(destination)
      results.push({ path: destination, status: path.resolve(resolved) === path.resolve(physicalCanonical) ? 'linked' : 'conflict' })
      continue
    } catch {
      // Missing and broken links are distinguished below with lstat.
    }
    try {
      await fs.lstat(destination)
      results.push({ path: destination, status: 'conflict' })
      continue
    } catch { /* absent */ }
    await fs.mkdir(root, { recursive: true })
    const target = process.platform === 'win32'
      ? path.resolve(canonicalSkillDir)
      : path.relative(root, canonicalSkillDir)
    try {
      await fs.symlink(target, destination, process.platform === 'win32' ? 'junction' : 'dir')
      results.push({ path: destination, status: 'created' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      results.push({ path: destination, status: 'conflict' })
    }
  }
  return results
}

async function reconcileCanonicalScope(scope: 'project' | 'global', projectPath: string): Promise<void> {
  const canonicalRoot = canonicalSkillsDir(scope, projectPath)
  let entries: string[]
  try { entries = await fs.readdir(canonicalRoot) } catch { return }
  const harnesses = await installedSkillHarnesses()
  const targets = new Set<string>()
  for (const harness of harnesses) {
    const locations = harness.getSkillLocations(scope, projectPath)
    if (locations.some((location) => location.canonical || path.resolve(location.path) === path.resolve(canonicalRoot))) continue
    const native = locations.find((location) => location.kind === 'native')
    if (native) targets.add(native.path)
  }
  await Promise.all(entries.map(async (entry) => {
    const skillDir = path.join(canonicalRoot, entry)
    try {
      if (!(await fs.stat(skillDir)).isDirectory()) return
      await fs.access(path.join(skillDir, 'SKILL.md'))
    } catch { return /* skip malformed entries */ }
    await reconcileSkillLinks(skillDir, [...targets])
  }))
}

async function listScope(
  scope: 'project' | 'global',
  projectPath: string,
): Promise<Skill[]> {
  await reconcileCanonicalScope(scope, projectPath)
  const canonicalRoot = canonicalSkillsDir(scope, projectPath)
  const physicalCanonicalRoot = await fs.realpath(canonicalRoot).catch(() => path.resolve(canonicalRoot))
  const byPhysicalPath = new Map<string, Skill>()
  for (const root of skillRoots(scope, projectPath)) {
    let entries: string[]
    try { entries = await fs.readdir(root.path) } catch { continue }
    for (const entry of entries) {
      const registeredDir = path.join(root.path, entry)
      try {
        if (!(await fs.stat(registeredDir)).isDirectory()) continue
        const physicalDir = await fs.realpath(registeredDir)
        const content = await fs.readFile(path.join(physicalDir, 'SKILL.md'), 'utf8')
        const { name, description, body } = parseFrontmatter(content)
        const key = path.resolve(physicalDir)
        const existing = byPhysicalPath.get(key)
        if (existing) {
          if (!existing.locations.includes(registeredDir)) existing.locations.push(registeredDir)
          existing.harnessIds = [...new Set([...existing.harnessIds, ...root.harnessIds])].sort()
          continue
        }
        byPhysicalPath.set(key, {
          id: entry,
          scope,
          ...(scope === 'project' ? { projectPath } : {}),
          path: key,
          locations: [registeredDir],
          harnessIds: [...root.harnessIds].sort(),
          managed: isWithin(physicalCanonicalRoot, key),
          conflict: false,
          name: name || entry,
          description,
          body,
        })
      } catch {
        // Skip malformed, missing, or broken skill entries.
      }
    }
  }
  const results = [...byPhysicalPath.values()]
  const counts = new Map<string, number>()
  for (const skill of results) counts.set(skill.id, (counts.get(skill.id) ?? 0) + 1)
  for (const skill of results) skill.conflict = (counts.get(skill.id) ?? 0) > 1
  return results.sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path))
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
    ['add', resolvedSource, '-a', MANAGED_SKILLS_INSTALL_AGENT, '-l', '-y'],
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
  // The universal target writes to the shared `.agents/skills` store at both
  // scopes. AgentKeeper creates the minimal compatibility links afterward.
  const args: string[] = ['add', resolvedSource, '-a', MANAGED_SKILLS_INSTALL_AGENT, '-y']
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
  await reconcileCanonicalScope(scope, projectPath)
}

export async function removeSkill(projectPath: string, skill: Skill): Promise<void> {
  const owningProject = skill.scope === 'project' ? skill.projectPath ?? projectPath : projectPath
  if (skill.scope === 'project' && !owningProject) throw new Error('The skill’s owning project is unknown.')
  const current = await listSkills(owningProject)
  const found = current.find((candidate) => candidate.scope === skill.scope && candidate.path === path.resolve(skill.path))
  if (!found) throw new Error('Skill is no longer installed.')
  const allowedRoots = skillRoots(found.scope, owningProject).map((root) => root.path)
  const locations = [...found.locations].sort((a, b) => Number(a === found.path) - Number(b === found.path))
  for (const location of locations) {
    if (!allowedRoots.some((root) => isWithin(root, location))) throw new Error('Refusing to remove a skill outside registered skill directories.')
    await fs.rm(location, { recursive: true, force: true })
  }
}

/** Move an existing harness-specific skill into the canonical store and leave
 * a compatibility link in its original location. A recoverable backup is kept
 * outside all harness discovery roots. */
export async function adoptSkill(
  projectPath: string,
  skill: Skill,
  backupBasePath: string,
): Promise<void> {
  const owningProject = skill.scope === 'project' ? skill.projectPath ?? projectPath : projectPath
  if (skill.scope === 'project' && !owningProject) throw new Error('The skill’s owning project is unknown.')
  const current = await listSkills(owningProject)
  const found = current.find((candidate) => candidate.scope === skill.scope && candidate.path === path.resolve(skill.path))
  if (!found) throw new Error('Skill is no longer installed.')
  if (found.managed) return
  if (found.conflict) throw new Error('Resolve the same-name skill conflict before making this skill available everywhere.')

  const roots = skillRoots(found.scope, owningProject).map((root) => root.path)
  let source: string | undefined
  for (const location of found.locations) {
    try {
      const stat = await fs.lstat(location)
      if (stat.isDirectory() && path.resolve(await fs.realpath(location)) === found.path) {
        source = location
        break
      }
    } catch { /* stale registration */ }
  }
  if (!source || !roots.some((root) => isWithin(root, source))) {
    throw new Error('This skill is linked from outside a registered skill directory and cannot be adopted safely.')
  }
  const canonicalRoot = canonicalSkillsDir(found.scope, owningProject)
  const destination = path.join(canonicalRoot, found.id)
  try {
    await fs.lstat(destination)
    throw new Error(`A canonical skill named '${found.id}' already exists.`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const token = `${Date.now()}-${randomUUID()}`
  const staging = path.join(canonicalRoot, `.agentkeeper-${token}.tmp`)
  const backupRoot = path.join(backupBasePath, 'skill-backups', found.scope, token)
  const backup = path.join(backupRoot, found.id)
  await fs.mkdir(canonicalRoot, { recursive: true })
  try {
    await fs.cp(source, staging, { recursive: true, errorOnExist: true })
    await fs.rename(staging, destination)
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  let sourceMoved = false
  try {
    await fs.mkdir(backupRoot, { recursive: true })
    await fs.rename(source, backup)
    sourceMoved = true
    const result = await reconcileSkillLinks(destination, [path.dirname(source)])
    if (result[0]?.status === 'conflict') throw new Error(`Could not link the canonical skill at '${source}'.`)
    await reconcileCanonicalScope(found.scope, owningProject)
  } catch (error) {
    if (sourceMoved) {
      await fs.rm(source, { recursive: true, force: true }).catch(() => {})
      await fs.rename(backup, source).catch(() => {})
    }
    await fs.rm(destination, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

const SKILL_GENERATION_SYSTEM = `You generate agent skill files. Output ONLY the skill markdown starting with \`---\`. No explanation, no code fences, no prose before or after.

Format:
---
name: <kebab-case-id>
description: <one-line description of what this skill does>
---

# Title

Instructions to the agent...`

function validateGeneratedSkill(raw: string): string {
  const text = stripAnsi(raw).trim()
  if (!text.startsWith('---')) {
    throw new Error('Generation returned unexpected format — try rephrasing the prompt.')
  }
  return text
}

export async function generateSkillContent(prompt: string): Promise<string> {
  const userContent = `Create an agent skill that does the following: ${prompt}`
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
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error('Skill ID must use lowercase letters, numbers, and single hyphens.')
  }
  const dir = canonicalSkillsDir(scope, projectPath)
  const skillDir = path.join(dir, id)
  const skillFile = path.join(skillDir, 'SKILL.md')
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(skillFile, content.trimEnd() + '\n', 'utf8')
  await reconcileCanonicalScope(scope, projectPath)
  const { name, description, body } = parseFrontmatter(content)
  return {
    id, scope, ...(scope === 'project' ? { projectPath } : {}), path: skillDir,
    locations: [skillDir], harnessIds: [], managed: true,
    conflict: false, name: name || id, description, body,
  }
}
