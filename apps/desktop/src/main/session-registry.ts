import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { getDb } from './db/index'
import { agencies, sessions } from './db/schema'
import type { LiveSessionStatus, PersistedAgency, PersistedSession } from '../shared/ipc-contract'
export type { PersistedAgency, PersistedSession }

const SESSION_CAP = 50

function rowToSession(row: typeof sessions.$inferSelect): PersistedSession {
  return {
    localId: row.localId,
    sdkSessionId: row.sdkSessionId ?? '',
    projectPath: row.projectPath,
    worktreePath: row.worktreePath ?? null,
    branch: row.branch ?? null,
    model: row.model ?? null,
    effort: row.effort ?? null,
    permissionMode: row.permissionMode as PersistedSession['permissionMode'],
    initialPrompt: row.initialPrompt,
    roleName: row.roleName ?? null,
    roleId: row.roleId ?? null,
    agencyInstanceId: row.agencyInstanceId ?? null,
    agencyName: row.agencyName ?? null,
    title: row.title ?? null,
    workItemKey: row.workItemKey ?? null,
    workItemTitle: row.workItemTitle ?? null,
    status: row.status as LiveSessionStatus,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
  }
}

function rowToAgency(row: typeof agencies.$inferSelect): PersistedAgency {
  return {
    instanceId: row.instanceId,
    agencyId: row.agencyId,
    agencyScope: row.agencyScope as PersistedAgency['agencyScope'],
    agencyName: row.agencyName,
    workItemTitle: row.workItemTitle ?? null,
    initialPrompt: row.initialPrompt,
    title: row.title ?? null,
    projectPath: row.projectPath,
    worktreePath: row.worktreePath ?? null,
    branch: row.branch ?? null,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
    roleSessionMap: JSON.parse(row.roleSessionMap) as PersistedAgency['roleSessionMap'],
    handoffs: JSON.parse(row.handoffs) as PersistedAgency['handoffs'],
  }
}

export function registerSession(session: PersistedSession): void {
  const db = getDb()
  db.insert(sessions).values({
    localId: session.localId,
    sdkSessionId: session.sdkSessionId ?? null,
    projectPath: session.projectPath,
    worktreePath: session.worktreePath ?? null,
    branch: session.branch ?? null,
    model: session.model ?? null,
    effort: session.effort ?? null,
    permissionMode: session.permissionMode ?? null,
    initialPrompt: session.initialPrompt ?? '',
    roleName: session.roleName ?? null,
    roleId: session.roleId ?? null,
    agencyInstanceId: session.agencyInstanceId ?? null,
    agencyName: session.agencyName ?? null,
    title: session.title ?? null,
    workItemKey: session.workItemKey ?? null,
    workItemTitle: session.workItemTitle ?? null,
    status: session.status ?? 'idle',
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
  }).onConflictDoUpdate({
    target: sessions.localId,
    set: {
      sdkSessionId: session.sdkSessionId ?? null,
      status: session.status ?? 'idle',
      lastActivityAt: session.lastActivityAt,
    },
  }).run()

  // Cap standalone sessions at SESSION_CAP per project.
  const standalone = db.select({ localId: sessions.localId, lastActivityAt: sessions.lastActivityAt })
    .from(sessions)
    .where(and(eq(sessions.projectPath, session.projectPath), isNull(sessions.agencyInstanceId)))
    .orderBy(sessions.lastActivityAt)
    .all()

  if (standalone.length > SESSION_CAP) {
    const toDelete = standalone.slice(0, standalone.length - SESSION_CAP)
    for (const s of toDelete) {
      db.delete(sessions).where(eq(sessions.localId, s.localId)).run()
    }
  }
}

export function updateSession(localId: string, partial: Partial<PersistedSession>): void {
  const db = getDb()
  const { roleSessionMap: _rm, handoffs: _h, ...rest } = partial as Record<string, unknown>
  db.update(sessions).set(rest as Partial<typeof sessions.$inferInsert>).where(eq(sessions.localId, localId)).run()
}

export function getSession(localId: string): PersistedSession | null {
  const row = getDb().select().from(sessions).where(eq(sessions.localId, localId)).get()
  return row ? rowToSession(row) : null
}

export function listSessions(projectPath: string): PersistedSession[] {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.projectPath, projectPath))
    .orderBy(desc(sessions.lastActivityAt))
    .all()
    .map(rowToSession)
}

export function registerAgency(agency: PersistedAgency): void {
  const db = getDb()
  db.insert(agencies).values({
    instanceId: agency.instanceId,
    agencyId: agency.agencyId,
    agencyScope: agency.agencyScope,
    agencyName: agency.agencyName,
    workItemTitle: agency.workItemTitle ?? null,
    initialPrompt: agency.initialPrompt ?? '',
    title: agency.title ?? null,
    projectPath: agency.projectPath,
    worktreePath: agency.worktreePath ?? null,
    branch: agency.branch ?? null,
    startedAt: agency.startedAt,
    lastActivityAt: agency.lastActivityAt,
    roleSessionMap: JSON.stringify(agency.roleSessionMap ?? {}),
    handoffs: JSON.stringify(agency.handoffs ?? {}),
  }).onConflictDoUpdate({
    target: agencies.instanceId,
    set: {
      lastActivityAt: agency.lastActivityAt,
      roleSessionMap: JSON.stringify(agency.roleSessionMap ?? {}),
      handoffs: JSON.stringify(agency.handoffs ?? {}),
    },
  }).run()

  // Cap agencies at SESSION_CAP per project.
  const forProject = db.select({ instanceId: agencies.instanceId, lastActivityAt: agencies.lastActivityAt })
    .from(agencies)
    .where(eq(agencies.projectPath, agency.projectPath))
    .orderBy(agencies.lastActivityAt)
    .all()

  if (forProject.length > SESSION_CAP) {
    const toDelete = forProject.slice(0, forProject.length - SESSION_CAP)
    for (const a of toDelete) {
      // Remove member sessions along with the agency.
      db.delete(sessions).where(eq(sessions.agencyInstanceId, a.instanceId)).run()
      db.delete(agencies).where(eq(agencies.instanceId, a.instanceId)).run()
    }
  }
}

export function updateAgency(
  instanceId: string,
  partial: Omit<Partial<PersistedAgency>, 'roleSessionMap' | 'handoffs'> & {
    roleSessionMap?: Record<string, Array<{ instanceIndex: number; sdkSessionId: string }>>
    handoffs?: Record<string, Array<{ instanceIndex: number; summary: string; timestamp: number }>>
  },
): void {
  const db = getDb()
  const existing = getAgency(instanceId)
  if (!existing) return

  const { roleSessionMap, handoffs, ...rest } = partial

  const mergedRoleSessionMap = existing.roleSessionMap
  if (roleSessionMap) {
    for (const [roleId, entries] of Object.entries(roleSessionMap)) {
      if (!mergedRoleSessionMap[roleId]) mergedRoleSessionMap[roleId] = []
      for (const entry of entries) {
        const already = mergedRoleSessionMap[roleId]!.findIndex(
          (e) => e.instanceIndex === entry.instanceIndex,
        )
        if (already === -1) mergedRoleSessionMap[roleId]!.push(entry)
        else mergedRoleSessionMap[roleId]![already] = entry
      }
    }
  }

  const mergedHandoffs = existing.handoffs
  if (handoffs) {
    for (const [roleId, entries] of Object.entries(handoffs)) {
      if (!mergedHandoffs[roleId]) mergedHandoffs[roleId] = []
      mergedHandoffs[roleId]!.push(...entries)
    }
  }

  const updateSet: Record<string, unknown> = {
    ...rest,
    roleSessionMap: JSON.stringify(mergedRoleSessionMap),
    handoffs: JSON.stringify(mergedHandoffs),
  }
  db.update(agencies).set(updateSet as Partial<typeof agencies.$inferInsert>).where(eq(agencies.instanceId, instanceId)).run()
}

export function getAgency(instanceId: string): PersistedAgency | null {
  const row = getDb().select().from(agencies).where(eq(agencies.instanceId, instanceId)).get()
  return row ? rowToAgency(row) : null
}

export function listAgencies(projectPath: string): PersistedAgency[] {
  return getDb()
    .select()
    .from(agencies)
    .where(eq(agencies.projectPath, projectPath))
    .orderBy(desc(agencies.lastActivityAt))
    .all()
    .map(rowToAgency)
}

export function deleteSession(localId: string): void {
  getDb().delete(sessions).where(eq(sessions.localId, localId)).run()
}

export function deleteAgency(instanceId: string): void {
  const db = getDb()
  db.delete(sessions).where(eq(sessions.agencyInstanceId, instanceId)).run()
  db.delete(agencies).where(eq(agencies.instanceId, instanceId)).run()
}

export function deleteAllForProject(projectPath: string): void {
  const db = getDb()
  const projectAgencies = db.select({ instanceId: agencies.instanceId })
    .from(agencies)
    .where(eq(agencies.projectPath, projectPath))
    .all()

  for (const a of projectAgencies) {
    db.delete(sessions).where(eq(sessions.agencyInstanceId, a.instanceId)).run()
  }
  db.delete(agencies).where(eq(agencies.projectPath, projectPath)).run()
  db.delete(sessions).where(eq(sessions.projectPath, projectPath)).run()
}

export function touchSession(localId: string): void {
  getDb().update(sessions).set({ lastActivityAt: Date.now() }).where(eq(sessions.localId, localId)).run()
}

export function listSessionsByAgency(agencyInstanceId: string): PersistedSession[] {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.agencyInstanceId, agencyInstanceId))
    .all()
    .map(rowToSession)
}

export function touchAgency(instanceId: string): void {
  getDb().update(agencies).set({ lastActivityAt: Date.now() }).where(eq(agencies.instanceId, instanceId)).run()
}

export function pruneExpired(thresholdDays: number | null): void {
  if (thresholdDays === null) return
  const db = getDb()
  const cutoff = Date.now() - thresholdDays * 86_400_000

  // Find agencies to prune so their member sessions can be cleaned up first.
  const expiredAgencies = db.select({ instanceId: agencies.instanceId })
    .from(agencies)
    .where(lt(agencies.lastActivityAt, cutoff))
    .all()

  for (const a of expiredAgencies) {
    db.delete(sessions).where(eq(sessions.agencyInstanceId, a.instanceId)).run()
  }
  db.delete(agencies).where(lt(agencies.lastActivityAt, cutoff)).run()
  db.delete(sessions).where(lt(sessions.lastActivityAt, cutoff)).run()
}
