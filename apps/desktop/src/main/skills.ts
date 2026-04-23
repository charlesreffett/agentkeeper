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

type ResolvedSource =
  | { type: 'local'; path: string }
  | { type: 'remote'; url: string }

/**
 * Classify a user-provided source string.
 *  - local path (absolute, ./rel, ../rel)  → read in place
 *  - http(s) / git@ / owner/repo            → git clone
 */
function classifySource(source: string): ResolvedSource {
  const trimmed = source.trim()
  if (/^(\.{1,2}\/|\/)/.test(trimmed)) return { type: 'local', path: trimmed }
  if (/^https?:\/\//.test(trimmed)) return { type: 'remote', url: trimmed }
  if (/^git@/.test(trimmed)) return { type: 'remote', url: trimmed }
  if (/^[a-zA-Z0-9_][\w.-]*\/[\w.-]+$/.test(trimmed)) {
    return { type: 'remote', url: `https://github.com/${trimmed}.git` }
  }
  // Ambiguous — treat as local path and let the read error speak if wrong.
  return { type: 'local', path: trimmed }
}

async function gitClone(url: string, dest: string): Promise<void> {
  try {
    await execFileAsync('git', ['clone', '--depth', '1', url, dest], {
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch (err) {
    const message =
      (err as NodeJS.ErrnoException & { stderr?: string }).stderr?.trim() ||
      (err instanceof Error ? err.message : String(err))
    throw new Error(`git clone failed: ${message}`)
  }
}

/** Recursively locate every SKILL.md under `root`, skipping hidden dirs. */
async function findSkillFiles(root: string): Promise<string[]> {
  const results: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as
        import('node:fs').Dirent[]
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue // skip .git, .github, .claude etc.
      if (e.name === 'node_modules') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.isFile() && e.name === 'SKILL.md') {
        results.push(full)
      }
    }
  }
  await walk(root)
  return results
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const entries = (await fs.readdir(src, { withFileTypes: true })) as unknown as
    import('node:fs').Dirent[]
  for (const e of entries) {
    const srcPath = path.join(src, e.name)
    const destPath = path.join(dest, e.name)
    if (e.isDirectory()) {
      await copyDir(srcPath, destPath)
    } else if (e.isFile()) {
      await fs.copyFile(srcPath, destPath)
    }
  }
}

async function withSourceRoot<T>(
  projectPath: string,
  source: string,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const resolved = classifySource(source)
  if (resolved.type === 'local') {
    const abs = path.isAbsolute(resolved.path)
      ? resolved.path
      : path.resolve(projectPath, resolved.path)
    const stat = await fs.stat(abs).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      throw new Error(`Source path is not a directory: ${abs}`)
    }
    return await fn(abs)
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'orchestral-skills-'))
  try {
    await gitClone(resolved.url, tmp)
    return await fn(tmp)
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

function deriveId(skillDir: string, root: string): string {
  // Prefer the directory name. If two skills in the same source share a
  // basename, disambiguate with the parent directory.
  const rel = path.relative(root, skillDir)
  const parts = rel.split(path.sep).filter(Boolean)
  return parts[parts.length - 1] ?? path.basename(skillDir)
}

async function collectPreviews(root: string): Promise<SkillPreview[]> {
  const files = await findSkillFiles(root)
  const previews: SkillPreview[] = []
  const seenIds = new Set<string>()
  for (const file of files) {
    const skillDir = path.dirname(file)
    let id = deriveId(skillDir, root)
    // Resolve id collisions by prefixing with parent dir name.
    if (seenIds.has(id)) {
      const parentName = path.basename(path.dirname(skillDir))
      id = parentName ? `${parentName}-${id}` : `${id}-dup`
    }
    seenIds.add(id)
    try {
      const content = await fs.readFile(file, 'utf8')
      const { name, description } = parseFrontmatter(content)
      previews.push({
        id,
        name: name || id,
        description: description || '',
      })
    } catch {
      // unreadable SKILL.md — skip
    }
  }
  previews.sort((a, b) => a.name.localeCompare(b.name))
  return previews
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
  return withSourceRoot(projectPath, source, (root) => collectPreviews(root))
}

export async function installSkill(
  projectPath: string,
  source: string,
  scope: 'project' | 'global',
  skillIds?: string[],
): Promise<void> {
  await withSourceRoot(projectPath, source, async (root) => {
    const files = await findSkillFiles(root)
    const wanted = skillIds && skillIds.length > 0 ? new Set(skillIds) : null
    const destRoot =
      scope === 'global' ? globalSkillsDir() : projectSkillsDir(projectPath)
    await fs.mkdir(destRoot, { recursive: true })

    const installed: string[] = []
    for (const file of files) {
      const skillDir = path.dirname(file)
      const id = deriveId(skillDir, root)
      if (wanted && !wanted.has(id)) continue
      const destDir = path.join(destRoot, id)
      await fs.rm(destDir, { recursive: true, force: true })
      await copyDir(skillDir, destDir)
      installed.push(id)
    }

    if (wanted) {
      const missing = [...wanted].filter((id) => !installed.includes(id))
      if (missing.length > 0) {
        throw new Error(
          `Requested skills not found in source: ${missing.join(', ')}`,
        )
      }
    }
  })
}

export async function removeSkill(skill: Skill): Promise<void> {
  await fs.rm(skill.path, { recursive: true, force: true })
}
