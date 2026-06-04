import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { getDb } from './db/index'
import { agencyHandoffs, agents, sessions } from './db/schema'
import type { Agent, AgencyScope, LiveSessionStatus, PlanTodo, RoleEffort, Session } from '../shared/ipc-contract'
export type { Agent, Session }

const SESSION_CAP = 100

export interface HandoffRecord {
  instanceIndex: number
  summary: string
  timestamp: number
}

function rowToSession(row: typeof sessions.$inferSelect): Session {
  return {
    localId: row.localId,
    projectPath: row.projectPath,
    worktreePath: row.worktreePath ?? null,
    branch: row.branch ?? null,
    model: row.model ?? null,
    effort: row.effort as RoleEffort | null,
    permissionMode: row.permissionMode as Session['permissionMode'],
    initialPrompt: row.initialPrompt,
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

function rowToAgent(row: typeof agents.$inferSelect): Agent {
  return {
    localId: row.localId,
    sessionLocalId: row.sessionLocalId,
    sdkSessionId: row.sdkSessionId ?? null,
    roleId: row.roleId ?? null,
    roleName: row.roleName ?? null,
    roleInstanceIndex: row.roleInstanceIndex ?? null,
    initialPrompt: row.initialPrompt,
    isEntryPoint: row.isEntryPoint === 1,
    status: row.status as LiveSessionStatus,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
  }
}

export function computeSessionStatus(agentList: Agent[]): LiveSessionStatus {
  if (agentList.length === 0) return 'idle'
  if (agentList.some(a => a.status === 'running' || a.status === 'starting')) return 'running'
  if (agentList.some(a => a.status === 'blocked')) return 'blocked'
  if (agentList.every(a => a.status === 'completed')) return 'completed'
  if (agentList.every(a => a.status === 'inactive')) return 'inactive'
  if (agentList.some(a => a.status === 'error')) return 'error'
  return 'idle'
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

export function registerSession(session: Session): void {
  const db = getDb()
  db.insert(sessions).values({
    localId: session.localId,
    projectPath: session.projectPath,
    worktreePath: session.worktreePath ?? null,
    branch: session.branch ?? null,
    model: session.model ?? null,
    effort: session.effort ?? null,
    permissionMode: session.permissionMode ?? null,
    initialPrompt: session.initialPrompt ?? '',
    agencyName: session.agencyName ?? null,
    agencyId: session.agencyId ?? null,
    agencyScope: session.agencyScope ?? null,
    title: session.title ?? null,
    workItemKey: session.workItemKey ?? null,
    workItemTitle: session.workItemTitle ?? null,
    status: session.status ?? 'idle',
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
  }).onConflictDoUpdate({
    target: sessions.localId,
    set: {
      status: session.status ?? 'idle',
      lastActivityAt: session.lastActivityAt,
    },
  }).run()

  // Cap sessions at SESSION_CAP per project (all sessions are top-level after migration).
  const all = db.select({ localId: sessions.localId, lastActivityAt: sessions.lastActivityAt })
    .from(sessions)
    .where(eq(sessions.projectPath, session.projectPath))
    .orderBy(sessions.lastActivityAt)
    .all()

  if (all.length > SESSION_CAP) {
    const toDelete = all.slice(0, all.length - SESSION_CAP)
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
  // ON DELETE CASCADE on agents → sessions handles agents rows.
  db.delete(sessions).where(eq(sessions.localId, instanceId)).run()
}

export function deleteAllForProject(projectPath: string): void {
  const db = getDb()
  // Collect session ids that are also agency instance ids before deleting so we can clean up handoffs.
  const sessionIds = db.select({ localId: sessions.localId })
    .from(sessions)
    .where(eq(sessions.projectPath, projectPath))
    .all()
    .map((s) => s.localId)
  for (const id of sessionIds) {
    db.delete(agencyHandoffs).where(eq(agencyHandoffs.agencyInstanceId, id)).run()
  }
  db.delete(sessions).where(eq(sessions.projectPath, projectPath)).run()
}

export function touchSession(localId: string): void {
  getDb().update(sessions).set({ lastActivityAt: Date.now() }).where(eq(sessions.localId, localId)).run()
}

// ── Agent CRUD ────────────────────────────────────────────────────────────────

export function registerAgent(agent: Agent): void {
  getDb().insert(agents).values({
    localId: agent.localId,
    sessionLocalId: agent.sessionLocalId,
    sdkSessionId: agent.sdkSessionId ?? null,
    roleId: agent.roleId ?? null,
    roleName: agent.roleName ?? null,
    roleInstanceIndex: agent.roleInstanceIndex ?? null,
    initialPrompt: agent.initialPrompt ?? '',
    isEntryPoint: agent.isEntryPoint ? 1 : 0,
    status: agent.status ?? 'idle',
    startedAt: agent.startedAt,
    lastActivityAt: agent.lastActivityAt,
  }).onConflictDoUpdate({
    target: agents.localId,
    set: {
      sdkSessionId: agent.sdkSessionId ?? null,
      status: agent.status ?? 'idle',
      lastActivityAt: agent.lastActivityAt,
    },
  }).run()
}

export function updateAgent(localId: string, partial: Partial<Agent>): void {
  const dbSet: Partial<typeof agents.$inferInsert> = {}
  if (partial.sdkSessionId !== undefined) dbSet.sdkSessionId = partial.sdkSessionId
  if (partial.status !== undefined) dbSet.status = partial.status
  if (partial.lastActivityAt !== undefined) dbSet.lastActivityAt = partial.lastActivityAt
  if (partial.roleId !== undefined) dbSet.roleId = partial.roleId
  if (partial.roleName !== undefined) dbSet.roleName = partial.roleName
  if (partial.roleInstanceIndex !== undefined) dbSet.roleInstanceIndex = partial.roleInstanceIndex
  if (partial.initialPrompt !== undefined) dbSet.initialPrompt = partial.initialPrompt
  if (partial.isEntryPoint !== undefined) dbSet.isEntryPoint = partial.isEntryPoint ? 1 : 0
  if (Object.keys(dbSet).length === 0) return
  getDb().update(agents).set(dbSet).where(eq(agents.localId, localId)).run()
}

export function getAgent(localId: string): Agent | null {
  const row = getDb().select().from(agents).where(eq(agents.localId, localId)).get()
  return row ? rowToAgent(row) : null
}

export function getAgentBySdkId(sdkSessionId: string): Agent | undefined {
  const row = getDb().select().from(agents).where(eq(agents.sdkSessionId, sdkSessionId)).get()
  return row ? rowToAgent(row) : undefined
}

export function listAgentsBySession(sessionLocalId: string): Agent[] {
  return getDb()
    .select()
    .from(agents)
    .where(eq(agents.sessionLocalId, sessionLocalId))
    .all()
    .map(rowToAgent)
}

export function listTrackedSdkIds(projectPath: string): string[] {
  const db = getDb()
  return db
    .selectDistinct({ sdkSessionId: agents.sdkSessionId })
    .from(agents)
    .innerJoin(sessions, eq(agents.sessionLocalId, sessions.localId))
    .where(and(eq(sessions.projectPath, projectPath), isNotNull(agents.sdkSessionId)))
    .all()
    .map((r) => r.sdkSessionId!)
}

// ── Handoffs ──────────────────────────────────────────────────────────────────

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

// ── Maintenance ───────────────────────────────────────────────────────────────

// Reset any sessions/agents that were left in a non-terminal state by a
// previous app process. Called once at startup before any live agents exist.
export function resetStaleRunning(): void {
  const db = getDb()
  const staleStatuses = ['running', 'starting', 'blocked']
  db.update(agents)
    .set({ status: 'inactive' })
    .where(inArray(agents.status, staleStatuses))
    .run()
  db.update(sessions)
    .set({ status: 'inactive' })
    .where(inArray(sessions.status, staleStatuses))
    .run()
}

export function pruneExpired(thresholdDays: number | null): void {
  if (thresholdDays === null) return
  const db = getDb()
  const cutoff = Date.now() - thresholdDays * 86_400_000
  const expiredIds = db.select({ id: sessions.localId })
    .from(sessions)
    .where(lt(sessions.lastActivityAt, cutoff))
    .all()
    .map((r) => r.id)
  for (const id of expiredIds) {
    db.delete(agencyHandoffs).where(eq(agencyHandoffs.agencyInstanceId, id)).run()
  }
  // ON DELETE CASCADE removes agents rows when sessions rows are deleted.
  db.delete(sessions).where(lt(sessions.lastActivityAt, cutoff)).run()
}

// ── Legacy helpers (kept temporarily for session:input handler compat) ────────

export function getSessionBySdkId(sdkSessionId: string): Session | undefined {
  const agent = getAgentBySdkId(sdkSessionId)
  if (!agent) return undefined
  return getSession(agent.sessionLocalId) ?? undefined
}

export function listSessionsByAgency(agencyInstanceId: string): Agent[] {
  return listAgentsBySession(agencyInstanceId)
}

export function getSessionRoleInstanceIndex(localId: string): number | null {
  return getAgent(localId)?.roleInstanceIndex ?? null
}
