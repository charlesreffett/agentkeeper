import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import Anthropic from '@anthropic-ai/sdk'
import {
  isGeneralProject,
  ROLE_EFFORT_VALUES,
  type Role,
  type RoleEffort,
  type RolesGenerateResult,
  type RoleScope,
} from '../shared/ipc-contract'
import { resolveClaudeAuth } from './secrets'
import { getHarness } from './harness/index'

function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[\d;?>=!]*[@-~]/g, '')
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[A-Za-z=>]/g, '')
}

const PROJECT_ROLES_DIR = '.agentkeeper/roles'
const GLOBAL_ROLES_DIR = '.agentkeeper/roles'

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
  const body = trimmed.slice(end + 4).replace(/^(\r?\n)+/, '')
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
  const icon = typeof parsed['icon'] === 'string' ? parsed['icon'] : undefined
  const accent = typeof parsed['accent'] === 'string' ? parsed['accent'] : undefined
  return {
    id: meta.id,
    scope: meta.scope,
    path: meta.path,
    name,
    description,
    model,
    effort,
    systemPrompt: body.trimEnd(),
    icon,
    accent,
  }
}

function serializeRole(role: Omit<Role, 'scope' | 'path'>): string {
  const fm: Record<string, unknown> = {
    name: role.name,
    description: role.description,
  }
  if (role.model) fm['model'] = role.model
  if (role.effort) fm['effort'] = role.effort
  if (role.icon) fm['icon'] = role.icon
  if (role.accent) fm['accent'] = role.accent
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
    // General chats have no project directory — only global roles apply.
    isGeneralProject(projectPath) ? [] : listScope('project', projectPath),
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

const ROLE_GENERATION_PROMPT = (prompt: string) =>
  `You are helping configure an AI agent role for AgentKeeper, an Electron app that drives AI agent sessions.

Generate a complete role definition for: "${prompt}"

Respond with ONLY a JSON object — no markdown fences, no prose:
{
  "id": "<lowercase alphanumeric + dashes only, ≤ 30 chars, must match ^[a-z0-9][a-z0-9-]*$>",
  "name": "<short display name, title case, ≤ 30 chars>",
  "description": "<one sentence, what this role does, ≤ 120 chars>",
  "systemPrompt": "<detailed system prompt, 150–400 words, written in second person ('You are…'), covering the role's responsibilities, constraints, and working style>"
}

Roles run with the full default toolset — express behavioral constraints (e.g. "you review, you do not edit") in the systemPrompt, not as tool lists.`

const VALID_ID_RE = /^[a-z0-9][a-z0-9-]*$/

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
}

function parseRoleGenerationResponse(text: string): RolesGenerateResult {
  const cleaned = stripAnsi(text).trim()
  const parsed = JSON.parse(cleaned)
  if (typeof parsed.systemPrompt !== 'string')
    throw new Error('Unexpected response shape from Claude')

  const name = String(parsed.name ?? '')
  const rawId = String(parsed.id ?? '')
  const id = VALID_ID_RE.test(rawId) ? rawId : slugify(name) || 'new-role'

  return {
    id,
    name,
    description: String(parsed.description ?? ''),
    systemPrompt: String(parsed.systemPrompt),
  }
}

export async function generateRoleContent(prompt: string): Promise<RolesGenerateResult> {
  const auth = await resolveClaudeAuth()
  const content = ROLE_GENERATION_PROMPT(prompt)

  if (auth.type === 'api-key') {
    const client = new Anthropic({ apiKey: auth.key })
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    })
    const first = message.content[0]
    const text = first?.type === 'text' ? first.text : ''
    return parseRoleGenerationResponse(text)
  }

  // Pro/Max path — harness CLI picks up `claude login` credentials
  try {
    const stdout = await getHarness().runCLI(['-p', content], { cwd: os.homedir(), timeout: 60_000 })
    return parseRoleGenerationResponse(stdout)
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string }
    if (e.code === 'ENOENT')
      throw new Error('CLI not found — make sure the agent harness is installed.')
    const raw = e.stderr?.trim() || e.stdout?.trim() || e.message || 'unknown error'
    throw new Error(`Role generation failed: ${stripAnsi(raw).trim()}`)
  }
}
