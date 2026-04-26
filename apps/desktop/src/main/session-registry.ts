import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AgencyScope, LiveSessionStatus } from '../shared/ipc-contract'

export interface PersistedSession {
  localId: string
  sdkSessionId: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  model: string | null
  effort: string | null
  initialPrompt: string
  roleName: string | null
  roleId: string | null
  agencyInstanceId: string | null
  agencyName: string | null
  startedAt: number
  lastActivityAt: number
  status: LiveSessionStatus
}

export interface PersistedAgency {
  instanceId: string
  agencyId: string
  agencyScope: AgencyScope
  agencyName: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  startedAt: number
  lastActivityAt: number
  /** roleId → sdkSessionId, populated as sessions initialise */
  roleSessionMap: Record<string, string>
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

export function registerSession(session: PersistedSession): void {
  const reg = load()
  reg.sessions[session.localId] = session
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
}

export function registerAgency(agency: PersistedAgency): void {
  const reg = load()
  reg.agencies[agency.instanceId] = agency
  save()
}

export function updateAgency(
  instanceId: string,
  partial: Omit<Partial<PersistedAgency>, 'roleSessionMap'> & {
    roleSessionMap?: Record<string, string>
  },
): void {
  const reg = load()
  const existing = reg.agencies[instanceId]
  if (!existing) return
  const { roleSessionMap, ...rest } = partial
  Object.assign(existing, rest)
  if (roleSessionMap) {
    Object.assign(existing.roleSessionMap, roleSessionMap)
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
