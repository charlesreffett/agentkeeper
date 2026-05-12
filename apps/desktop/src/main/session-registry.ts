import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { getDb } from './db/index'
import { agencyHandoffs, sessions } from './db/schema'
import type { AgencyScope, LiveSessionStatus, PlanTodo, RoleEffort, Session } from '../shared/ipc-contract'
export type { Session }

const SESSION_CAP = 50

export interface HandoffRecord {
  instanceIndex: number
  summary: string
  timestamp: number
}

function rowToSession(row: typeof sessions.$inferSelect): Session {
  return {
    localId: row.localId,
    sdkSessionId: row.sdkSessionId ?? null,
    projectPath: row.projectPath,
    worktreePath: row.worktreePath ?? null,
    branch: row.branch ?? null,
    model: row.model ?? null,
    effort: row.effort as RoleEffort | null,
    permissionMode: row.permissionMode as Session['permissionMode'],
    initialPrompt: row.initialPrompt,
    roleName: row.roleName ?? null,
    roleId: row.roleId ?? null,
    agencyInstanceId: row.agencyInstanceId ?? null,
    agencyName: row.agencyName ?? null,
    agencyId: row.agencyId ?? null,
    agencyScope: (row.agencyScope as AgencyScope) ?? null,
    title: row.title ?? null,
    workItemKey: row.workItemKey ?? null,
    workItemTitle: row.workItemTitle ?? null,
    planState: row.planState ? (JSON.parse(row.planState) as PlanTodo[]) : null,
    status: row.status as LiveSessionStatus,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
  }
}

export function registerSession(session: Session, roleInstanceIndex?: number): void {
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
    agencyId: session.agencyId ?? null,
    agencyScope: session.agencyScope ?? null,
    title: session.title ?? null,
    workItemKey: session.workItemKey ?? null,
    workItemTitle: session.workItemTitle ?? null,
    status: session.status ?? 'idle',
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    roleInstanceIndex: roleInstanceIndex ?? null,
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

export function updateSession(localId: string, partial: Partial<Session>): void {
  const { planState, ...rest } = partial
  const dbSet: Partial<typeof sessions.$inferInsert> = rest as Partial<typeof sessions.$inferInsert>
  if ('planState' in partial) {
    dbSet.planState = planState ? JSON.stringify(planState) : null
  }
  getDb().update(sessions).set(dbSet).where(eq(sessions.localId, localId)).run()
}

export function getSession(localId: string): Session | null {
  const row = getDb().select().from(sessions).where(eq(sessions.localId, localId)).get()
  return row ? rowToSession(row) : null
}

export function listSessions(projectPath: string): Session[] {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.projectPath, projectPath))
    .orderBy(desc(sessions.lastActivityAt))
    .all()
    .map(rowToSession)
}

export function deleteSession(localId: string): void {
  getDb().delete(sessions).where(eq(sessions.localId, localId)).run()
}

export function deleteAgency(instanceId: string): void {
  const db = getDb()
  db.delete(agencyHandoffs).where(eq(agencyHandoffs.agencyInstanceId, instanceId)).run()
  db.delete(sessions).where(eq(sessions.agencyInstanceId, instanceId)).run()
}

export function deleteAllForProject(projectPath: string): void {
  const db = getDb()
  // Collect agency instance ids before deleting sessions so we can clean up handoffs
  const agencySessions = db.select({ instanceId: sessions.agencyInstanceId })
    .from(sessions)
    .where(eq(sessions.projectPath, projectPath))
    .all()
  const instanceIds = [...new Set(agencySessions.map((s) => s.instanceId).filter((id): id is string => id !== null))]
  for (const instanceId of instanceIds) {
    db.delete(agencyHandoffs).where(eq(agencyHandoffs.agencyInstanceId, instanceId)).run()
  }
  db.delete(sessions).where(eq(sessions.projectPath, projectPath)).run()
}

export function touchSession(localId: string): void {
  getDb().update(sessions).set({ lastActivityAt: Date.now() }).where(eq(sessions.localId, localId)).run()
}

export function listSessionsByAgency(agencyInstanceId: string): Session[] {
  return getDb()
    .select()
    .from(sessions)
    .where(eq(sessions.agencyInstanceId, agencyInstanceId))
    .all()
    .map(rowToSession)
}

export function addHandoff(
  agencyInstanceId: string,
  roleId: string,
  instanceIndex: number,
  summary: string,
): void {
  getDb().insert(agencyHandoffs).values({
    agencyInstanceId,
    roleId,
    instanceIndex,
    summary,
    createdAt: Date.now(),
  }).run()
}

export function getHandoffsByRole(agencyInstanceId: string): Map<string, HandoffRecord[]> {
  const rows = getDb()
    .select()
    .from(agencyHandoffs)
    .where(eq(agencyHandoffs.agencyInstanceId, agencyInstanceId))
    .all()

  const result = new Map<string, HandoffRecord[]>()
  for (const row of rows) {
    let list = result.get(row.roleId)
    if (!list) { list = []; result.set(row.roleId, list) }
    list.push({ instanceIndex: row.instanceIndex, summary: row.summary, timestamp: row.createdAt })
  }
  return result
}

export function getSessionRoleInstanceIndex(localId: string): number | null {
  const row = getDb().select({ roleInstanceIndex: sessions.roleInstanceIndex }).from(sessions).where(eq(sessions.localId, localId)).get()
  return row?.roleInstanceIndex ?? null
}

export function getSessionBySdkId(sdkSessionId: string): Session | undefined {
  const row = getDb().select().from(sessions).where(eq(sessions.sdkSessionId, sdkSessionId)).get()
  return row ? rowToSession(row) : undefined
}

export function pruneExpired(thresholdDays: number | null): void {
  if (thresholdDays === null) return
  const db = getDb()
  const cutoff = Date.now() - thresholdDays * 86_400_000
  const expiredAgencyIds = db.selectDistinct({ id: sessions.agencyInstanceId })
    .from(sessions)
    .where(lt(sessions.lastActivityAt, cutoff))
    .all()
    .map((r) => r.id)
    .filter((id): id is string => id !== null)
  for (const instanceId of expiredAgencyIds) {
    db.delete(agencyHandoffs).where(eq(agencyHandoffs.agencyInstanceId, instanceId)).run()
  }
  db.delete(sessions).where(lt(sessions.lastActivityAt, cutoff)).run()
}
