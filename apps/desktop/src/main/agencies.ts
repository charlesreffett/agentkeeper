import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Agency, AgencyDraft, AgencyScope, OnFailurePolicy, RoleSlot } from '../shared/ipc-contract'

const PROJECT_DIR = '.agentkeeper/agencies'
const GLOBAL_DIR = '.agentkeeper/agencies'

function projectAgenciesDir(projectPath: string): string {
  return path.join(projectPath, PROJECT_DIR)
}

function globalAgenciesDir(): string {
  return path.join(os.homedir(), GLOBAL_DIR)
}

function scopeDir(scope: AgencyScope, projectPath: string): string {
  return scope === 'project'
    ? projectAgenciesDir(projectPath)
    : globalAgenciesDir()
}

function agencyPath(scope: AgencyScope, projectPath: string, id: string): string {
  return path.join(scopeDir(scope, projectPath), `${id}.md`)
}

function parseAgencyFile(
  source: string,
  meta: { scope: AgencyScope; path: string; id: string },
): Agency | null {
  const trimmed = source.replace(/^﻿/, '')
  if (!trimmed.startsWith('---')) return null
  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) return null
  const fm = trimmed.slice(3, end).replace(/^\r?\n/, '')
  const body = trimmed.slice(end + 4).replace(/^\r?\n+/, '').trimEnd()
  let parsed: Record<string, unknown>
  try {
    parsed = (parseYaml(fm) ?? {}) as Record<string, unknown>
  } catch {
    return null
  }
  const name = typeof parsed['name'] === 'string' ? parsed['name'] : meta.id
  const description =
    typeof parsed['description'] === 'string' ? parsed['description'] : ''
  const roles: RoleSlot[] = Array.isArray(parsed['roles'])
    ? (parsed['roles'] as unknown[]).flatMap((r): RoleSlot[] => {
        if (typeof r === 'string') return [{ roleId: r }]
        if (r && typeof r === 'object') {
          const obj = r as Record<string, unknown>
          if (typeof obj['id'] !== 'string') return []
          const id = obj['id']
          const slot: RoleSlot = { roleId: id }
          if (typeof obj['count'] === 'number') {
            slot.count = Math.max(1, Math.floor(obj['count']))
          } else if (typeof obj['min'] === 'number' || typeof obj['max'] === 'number') {
            slot.min = typeof obj['min'] === 'number' ? Math.max(1, Math.floor(obj['min'])) : 1
            slot.max = typeof obj['max'] === 'number' ? Math.floor(obj['max']) : (slot.min ?? 1) + 1
          }
          if (obj['openMessaging'] === true) slot.openMessaging = true
          const onFailureValues: OnFailurePolicy[] = ['block', 'continue', 'retry']
          if (typeof obj['onFailure'] === 'string' && onFailureValues.includes(obj['onFailure'] as OnFailurePolicy))
            slot.onFailure = obj['onFailure'] as OnFailurePolicy
          if (obj['pauseForReview'] === true) slot.pauseForReview = true
          return [slot]
        }
        return []
      })
    : []
  const flowsRaw = Array.isArray(parsed['flows']) ? parsed['flows'] : []
  const flows: Array<[string, string, string?, string?]> = []
  for (const f of flowsRaw) {
    if (Array.isArray(f) && f.length >= 2 && typeof f[0] === 'string' && typeof f[1] === 'string') {
      const srcHandle = typeof f[2] === 'string' ? f[2] : undefined
      const tgtHandle = typeof f[3] === 'string' ? f[3] : undefined
      flows.push([f[0], f[1], srcHandle, tgtHandle])
    }
  }
  const entryPoints = Array.isArray(parsed['entryPoints'])
    ? (parsed['entryPoints'] as unknown[]).filter(
        (r): r is string => typeof r === 'string',
      )
    : []
  const layoutRaw = parsed['layout']
  let layout: Record<string, { x: number; y: number }> | undefined
  if (layoutRaw && typeof layoutRaw === 'object' && !Array.isArray(layoutRaw)) {
    const entries = Object.entries(layoutRaw as Record<string, unknown>)
    const parsed2: Record<string, { x: number; y: number }> = {}
    for (const [k, v] of entries) {
      if (v && typeof v === 'object') {
        const pos = v as Record<string, unknown>
        if (typeof pos['x'] === 'number' && typeof pos['y'] === 'number') {
          parsed2[k] = { x: pos['x'], y: pos['y'] }
        }
      }
    }
    if (Object.keys(parsed2).length > 0) layout = parsed2
  }
  return {
    id: meta.id,
    scope: meta.scope,
    path: meta.path,
    name,
    description,
    roles,
    flows,
    entryPoints,
    notes: body,
    layout,
  }
}

function serializeRoleSlot(slot: RoleSlot): string | Record<string, unknown> {
  const hasExtras = slot.openMessaging || slot.onFailure || slot.pauseForReview
  if (!hasExtras) {
    if (slot.count !== undefined) {
      if (slot.count === 1) return slot.roleId
      return { id: slot.roleId, count: slot.count }
    }
    if (slot.min !== undefined || slot.max !== undefined) {
      return { id: slot.roleId, min: slot.min, max: slot.max }
    }
    return slot.roleId
  }
  const obj: Record<string, unknown> = { id: slot.roleId }
  if (slot.count !== undefined && slot.count !== 1) obj['count'] = slot.count
  if (slot.min !== undefined) obj['min'] = slot.min
  if (slot.max !== undefined) obj['max'] = slot.max
  if (slot.openMessaging) obj['openMessaging'] = true
  if (slot.onFailure) obj['onFailure'] = slot.onFailure
  if (slot.pauseForReview) obj['pauseForReview'] = true
  return obj
}

function serializeAgency(a: AgencyDraft): string {
  const fm: Record<string, unknown> = {
    name: a.name,
    description: a.description,
    roles: a.roles.map(serializeRoleSlot),
    flows: a.flows,
    entryPoints: a.entryPoints,
  }
  if (a.layout && Object.keys(a.layout).length > 0) fm['layout'] = a.layout
  return `---\n${stringifyYaml(fm).trimEnd()}\n---\n\n${(a.notes ?? '').trim()}\n`
}

async function listScope(
  scope: AgencyScope,
  projectPath: string,
): Promise<Agency[]> {
  const dir = scopeDir(scope, projectPath)
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const mdFiles = entries.filter((e) => e.endsWith('.md'))
  const out: Agency[] = []
  for (const filename of mdFiles) {
    const full = path.join(dir, filename)
    const id = filename.replace(/\.md$/, '')
    try {
      const content = await fs.readFile(full, 'utf8')
      const a = parseAgencyFile(content, { scope, path: full, id })
      if (a) out.push(a)
    } catch {
      /* skip */
    }
  }
  return out
}

export async function listAgencies(projectPath: string): Promise<Agency[]> {
  const [project, global] = await Promise.all([
    listScope('project', projectPath),
    listScope('global', projectPath),
  ])
  const byId = new Map<string, Agency>()
  for (const g of global) byId.set(g.id, g)
  for (const p of project) byId.set(p.id, p)
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function saveAgency(
  scope: AgencyScope,
  projectPath: string,
  draft: AgencyDraft,
): Promise<Agency> {
  const dir = scopeDir(scope, projectPath)
  await fs.mkdir(dir, { recursive: true })
  const filePath = agencyPath(scope, projectPath, draft.id)
  await fs.writeFile(filePath, serializeAgency(draft), 'utf8')
  return { ...draft, scope, path: filePath }
}

export async function deleteAgency(
  scope: AgencyScope,
  projectPath: string,
  id: string,
): Promise<void> {
  const filePath = agencyPath(scope, projectPath, id)
  try {
    await fs.unlink(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw err
  }
}
