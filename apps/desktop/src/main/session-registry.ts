import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { LiveSessionStatus, PersistedAgency } from '../shared/ipc-contract'
export type { PersistedAgency }

export interface PersistedSession {
  localId: string
  sdkSessionId: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  model: string | null
  effort: string | null
  permissionMode: string | null
  initialPrompt: string
  roleName: string | null
  roleId: string | null
  agencyInstanceId: string | null
  agencyName: string | null
  startedAt: number
  lastActivityAt: number
  status: LiveSessionStatus
  workItemKey: string | null
  workItemTitle: string | null
  title: string | null
}

interface Registry {
  sessions: Record<string, PersistedSession>
  agencies: Record<string, PersistedAgency>
}

let _registry: Registry | null = null

function registryPath(): string {
  return path.join(app.getPath('userData'), 'session-registry.json')
}

function load(): Registry {
  if (_registry) return _registry
  const p = registryPath()
  try {
    const raw = fs.readFileSync(p, 'utf8')
    _registry = JSON.parse(raw) as Registry
  } catch {
    _registry = { sessions: {}, agencies: {} }
  }
  if (!_registry.sessions) _registry.sessions = {}
  if (!_registry.agencies) _registry.agencies = {}
  return _registry
}

function save(): void {
  const reg = load()
  const p = registryPath()
  const tmp = `${p}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2), 'utf8')
  fs.renameSync(tmp, p)
}

const SESSION_CAP = 50

export function registerSession(session: PersistedSession): void {
  const reg = load()
  reg.sessions[session.localId] = session
  // Cap standalone sessions (agencyInstanceId === null) at 50 per project.
  const standalone = Object.values(reg.sessions).filter(
    (s) => s.projectPath === session.projectPath && s.agencyInstanceId === null,
  )
  if (standalone.length > SESSION_CAP) {
    standalone.sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    const toDelete = standalone.slice(0, standalone.length - SESSION_CAP)
    for (const s of toDelete) delete reg.sessions[s.localId]
  }
  save()
}

export function updateSession(localId: string, partial: Partial<PersistedSession>): void {
  const reg = load()
  const existing = reg.sessions[localId]
  if (!existing) return
  Object.assign(existing, partial)
  save()
}

export function getSession(localId: string): PersistedSession | null {
  return load().sessions[localId] ?? null
}

export function listSessions(projectPath: string): PersistedSession[] {
  const reg = load()
  return Object.values(reg.sessions)
    .filter((s) => s.projectPath === projectPath)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .map((s) => ({
      ...s,
      workItemKey: s.workItemKey ?? null,
      workItemTitle: s.workItemTitle ?? null,
      title: s.title ?? null,
    }))
}

export function registerAgency(agency: PersistedAgency): void {
  const reg = load()
  reg.agencies[agency.instanceId] = agency
  // Cap agencies at 50 per project.
  const forProject = Object.values(reg.agencies).filter(
    (a) => a.projectPath === agency.projectPath,
  )
  if (forProject.length > SESSION_CAP) {
    forProject.sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    const toDelete = forProject.slice(0, forProject.length - SESSION_CAP)
    for (const a of toDelete) {
      // Remove member sessions along with the agency.
      for (const s of Object.values(reg.sessions)) {
        if (s.agencyInstanceId === a.instanceId) delete reg.sessions[s.localId]
      }
      delete reg.agencies[a.instanceId]
    }
  }
  save()
}

export function updateAgency(
  instanceId: string,
  partial: Omit<Partial<PersistedAgency>, 'roleSessionMap' | 'handoffs'> & {
    roleSessionMap?: Record<string, Array<{ instanceIndex: number; sdkSessionId: string }>>
    handoffs?: Record<string, Array<{ instanceIndex: number; summary: string; timestamp: number }>>
  },
): void {
  const reg = load()
  const existing = reg.agencies[instanceId]
  if (!existing) return
  const { roleSessionMap, handoffs, ...rest } = partial
  Object.assign(existing, rest)
  if (roleSessionMap) {
    for (const [roleId, entries] of Object.entries(roleSessionMap)) {
      if (!existing.roleSessionMap[roleId]) existing.roleSessionMap[roleId] = []
      for (const entry of entries) {
        const already = existing.roleSessionMap[roleId].findIndex(
          (e) => e.instanceIndex === entry.instanceIndex,
        )
        if (already === -1) existing.roleSessionMap[roleId].push(entry)
        else existing.roleSessionMap[roleId][already] = entry
      }
    }
  }
  if (handoffs) {
    for (const [roleId, entries] of Object.entries(handoffs)) {
      if (!existing.handoffs[roleId]) existing.handoffs[roleId] = []
      existing.handoffs[roleId].push(...entries)
    }
  }
  save()
}

export function getAgency(instanceId: string): PersistedAgency | null {
  return load().agencies[instanceId] ?? null
}

export function listAgencies(projectPath: string): PersistedAgency[] {
  const reg = load()
  return Object.values(reg.agencies)
    .filter((a) => a.projectPath === projectPath)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

export function deleteSession(localId: string): void {
  const reg = load()
  delete reg.sessions[localId]
  save()
}

export function deleteAgency(instanceId: string): void {
  const reg = load()
  for (const s of Object.values(reg.sessions)) {
    if (s.agencyInstanceId === instanceId) delete reg.sessions[s.localId]
  }
  delete reg.agencies[instanceId]
  save()
}

export function deleteAllForProject(projectPath: string): void {
  const reg = load()
  for (const a of Object.values(reg.agencies)) {
    if (a.projectPath === projectPath) {
      for (const s of Object.values(reg.sessions)) {
        if (s.agencyInstanceId === a.instanceId) delete reg.sessions[s.localId]
      }
      delete reg.agencies[a.instanceId]
    }
  }
  for (const s of Object.values(reg.sessions)) {
    if (s.projectPath === projectPath) delete reg.sessions[s.localId]
  }
  save()
}

export function touchSession(localId: string): void {
  const reg = load()
  const s = reg.sessions[localId]
  if (!s) return
  s.lastActivityAt = Date.now()
  save()
}

export function listSessionsByAgency(agencyInstanceId: string): PersistedSession[] {
  return Object.values(load().sessions).filter((s) => s.agencyInstanceId === agencyInstanceId)
}

export function touchAgency(instanceId: string): void {
  const reg = load()
  const a = reg.agencies[instanceId]
  if (!a) return
  a.lastActivityAt = Date.now()
  save()
}

/**
 * Delete sessions and agencies for all projects where
 * lastActivityAt < (Date.now() - thresholdDays * 86_400_000).
 * When an agency is pruned its member sessions are removed too.
 */
export function pruneExpired(thresholdDays: number | null): void {
  if (thresholdDays === null) return
  const reg = load()
  const cutoff = Date.now() - thresholdDays * 86_400_000
  for (const a of Object.values(reg.agencies)) {
    if (a.lastActivityAt < cutoff) {
      for (const s of Object.values(reg.sessions)) {
        if (s.agencyInstanceId === a.instanceId) delete reg.sessions[s.localId]
      }
      delete reg.agencies[a.instanceId]
    }
  }
  for (const s of Object.values(reg.sessions)) {
    if (s.lastActivityAt < cutoff) delete reg.sessions[s.localId]
  }
  save()
}
