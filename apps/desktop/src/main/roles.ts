import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  ROLE_EFFORT_VALUES,
  type Role,
  type RoleEffort,
  type RoleScope,
} from '../shared/ipc-contract'

const PROJECT_ROLES_DIR = '.orchestral/roles'
const GLOBAL_ROLES_DIR = '.orchestral/roles'

function projectRolesDir(projectPath: string): string {
  return path.join(projectPath, PROJECT_ROLES_DIR)
}

function globalRolesDir(): string {
  return path.join(os.homedir(), GLOBAL_ROLES_DIR)
}

function scopeDir(scope: RoleScope, projectPath: string): string {
  return scope === 'project' ? projectRolesDir(projectPath) : globalRolesDir()
}

function rolePath(scope: RoleScope, projectPath: string, id: string): string {
  return path.join(scopeDir(scope, projectPath), `${id}.md`)
}

/**
 * Parse a role file: YAML frontmatter delimited by --- on its own lines,
 * followed by the markdown body (the system prompt).
 */
function parseRoleFile(
  source: string,
  meta: { scope: RoleScope; path: string; id: string },
): Role | null {
  const trimmed = source.replace(/^﻿/, '')
  if (!trimmed.startsWith('---')) return null
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return null
  const fm = trimmed.slice(3, end).replace(/^\r?\n/, '')
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '')
  let parsed: Record<string, unknown>
  try {
    parsed = (parseYaml(fm) ?? {}) as Record<string, unknown>
  } catch {
    return null
  }
  const name = typeof parsed['name'] === 'string' ? parsed['name'] : meta.id
  const description =
    typeof parsed['description'] === 'string' ? parsed['description'] : ''
  const model =
    typeof parsed['model'] === 'string' ? (parsed['model'] as string) : null
  const effort: RoleEffort | null =
    typeof parsed['effort'] === 'string' &&
    (ROLE_EFFORT_VALUES as string[]).includes(parsed['effort'] as string)
      ? (parsed['effort'] as RoleEffort)
      : null
  const allowedTools = Array.isArray(parsed['allowedTools'])
    ? (parsed['allowedTools'] as unknown[]).filter(
        (t): t is string => typeof t === 'string',
      )
    : null
  const allowedPeers = Array.isArray(parsed['allowedPeers'])
    ? (parsed['allowedPeers'] as unknown[]).filter(
        (t): t is string => typeof t === 'string',
      )
    : null
  return {
    id: meta.id,
    scope: meta.scope,
    path: meta.path,
    name,
    description,
    model,
    effort,
    allowedTools,
    allowedPeers,
    systemPrompt: body.trimEnd(),
  }
}

function serializeRole(role: Omit<Role, 'scope' | 'path'>): string {
  const fm: Record<string, unknown> = {
    name: role.name,
    description: role.description,
  }
  if (role.model) fm['model'] = role.model
  if (role.effort) fm['effort'] = role.effort
  if (role.allowedTools && role.allowedTools.length)
    fm['allowedTools'] = role.allowedTools
  if (role.allowedPeers && role.allowedPeers.length)
    fm['allowedPeers'] = role.allowedPeers
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${role.systemPrompt.trim()}\n`
}

async function listScope(
  scope: RoleScope,
  projectPath: string,
): Promise<Role[]> {
  const dir = scopeDir(scope, projectPath)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const mdFiles = entries.filter((e) => e.endsWith('.md'))
  const results: Role[] = []
  for (const filename of mdFiles) {
    const full = path.join(dir, filename)
    const id = filename.replace(/\.md$/, '')
    try {
      const content = await fs.readFile(full, 'utf8')
      const role = parseRoleFile(content, { scope, path: full, id })
      if (role) results.push(role)
    } catch {
      // skip unreadable / malformed files
    }
  }
  return results
}

export async function listRoles(projectPath: string): Promise<Role[]> {
  const [project, global] = await Promise.all([
    listScope('project', projectPath),
    listScope('global', projectPath),
  ])
  // project takes precedence over global on id collision
  const byId = new Map<string, Role>()
  for (const g of global) byId.set(g.id, g)
  for (const p of project) byId.set(p.id, p)
  return Array.from(byId.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
}

export async function saveRole(
  scope: RoleScope,
  projectPath: string,
  role: Omit<Role, 'scope' | 'path'>,
): Promise<Role> {
  const dir = scopeDir(scope, projectPath)
  await fs.mkdir(dir, { recursive: true })
  const filePath = rolePath(scope, projectPath, role.id)
  await fs.writeFile(filePath, serializeRole(role), 'utf8')
  return { ...role, scope, path: filePath }
}

export async function deleteRole(
  scope: RoleScope,
  projectPath: string,
  id: string,
): Promise<void> {
  const filePath = rolePath(scope, projectPath, id)
  try {
    await fs.unlink(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}
