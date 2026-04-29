import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import Anthropic from '@anthropic-ai/sdk'
import {
  ROLE_EFFORT_VALUES,
  type Role,
  type RoleEffort,
  type RolesGenerateResult,
  type RoleScope,
} from '../shared/ipc-contract'
import { resolveClaudeAuth } from './secrets'

const execFileAsync = promisify(execFile)

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

const ROLE_GENERATION_PROMPT = (prompt: string) =>
  `You are helping configure an AI agent role for AgentKeeper, an Electron app that drives Claude Code sessions.

Generate a complete role definition for: "${prompt}"

Respond with ONLY a JSON object — no markdown fences, no prose:
{
  "id": "<lowercase alphanumeric + dashes only, ≤ 30 chars, must match ^[a-z0-9][a-z0-9-]*$>",
  "name": "<short display name, title case, ≤ 30 chars>",
  "description": "<one sentence, what this role does, ≤ 120 chars>",
  "allowedTools": ["<tool name>", ...],
  "allowedPeers": ["<role-id>", ...] or [],
  "systemPrompt": "<detailed system prompt, 150–400 words, written in second person ('You are…'), covering the role's responsibilities, constraints, and working style>"
}

For allowedTools, choose from: Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch, Agent, TodoWrite, mcp__agentkeeper__send_message.
Pick only what the role genuinely needs — a reviewer needs Read/Grep/Glob but not Write/Bash; a developer needs most tools.
For allowedPeers, list the role IDs this role is allowed to send_message() to in an agency. Leave empty [] if this role doesn't need to delegate to peers.`

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
  const allowedTools = Array.isArray(parsed.allowedTools)
    ? (parsed.allowedTools as unknown[]).filter((t) => typeof t === 'string').map(String)
    : null
  const allowedPeers = Array.isArray(parsed.allowedPeers)
    ? (parsed.allowedPeers as unknown[]).filter((t) => typeof t === 'string').map(String)
    : null

  return {
    id,
    name,
    description: String(parsed.description ?? ''),
    allowedTools: allowedTools && allowedTools.length > 0 ? allowedTools : null,
    allowedPeers: allowedPeers && allowedPeers.length > 0 ? allowedPeers : null,
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

  // Pro/Max path — claude CLI picks up `claude login` credentials
  try {
    const result = await execFileAsync('claude', ['-p', content], {
      cwd: os.homedir(),
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env },
    })
    return parseRoleGenerationResponse(result.stdout)
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string }
    if (e.code === 'ENOENT')
      throw new Error('claude CLI not found — make sure Claude Code is installed.')
    const raw = e.stderr?.trim() || e.stdout?.trim() || e.message || 'unknown error'
    throw new Error(`Role generation failed: ${stripAnsi(raw).trim()}`)
  }
}
