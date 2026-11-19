import { randomUUID } from 'node:crypto'
import { eq, and, asc, inArray } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { getDb } from './db/index'
import { plans as plansTable, planSteps as planStepsTable, planSessions as planSessionsTable, sessions as sessionsTable } from './db/schema'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import type { Plan, PlanStep, PlansCreateInput, PlansStepPatch, PlansUpdateInput } from '../shared/ipc-contract'

function rowToPlan(
  row: typeof plansTable.$inferSelect,
  steps: (typeof planStepsTable.$inferSelect)[],
  sessionIds: string[],
): Plan {
  return {
    id: row.id,
    planRef: row.planRef ?? undefined,
    title: row.title,
    prompt: row.prompt ?? undefined,
    workItem: row.workItemSourceId && row.workItemId && row.workItemExternalRef
      ? {
          sourceId: row.workItemSourceId,
          itemId: row.workItemId,
          externalRef: row.workItemExternalRef,
          ...(row.workItemTitle ? { title: row.workItemTitle } : {}),
        }
      : undefined,
    agencyId: row.agencyId ?? null,
    agencyScope: (row.agencyScope as Plan['agencyScope']) ?? null,
    status: row.status as Plan['status'],
    estimatedMinutes: row.estimatedMinutes,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    ...(row.brief ? { brief: row.brief } : {}),
    sessionIds,
    steps: steps
      .sort((a, b) => a.position - b.position)
      .map(rowToStep),
  }
}

function rowToStep(row: typeof planStepsTable.$inferSelect): PlanStep {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary ?? undefined,
    instructions: row.instructions ?? undefined,
    filesInScope: JSON.parse(row.filesInScope) as string[],
    model: row.model,
    estimatedMinutes: row.estimatedMinutes,
    actualMinutes: row.actualMinutes ?? undefined,
    agent: row.agent,
    parallel: row.parallel === 1,
    status: row.status as PlanStep['status'],
    requiresApproval: row.requiresApproval === 1,
    context: row.context ?? undefined,
  }
}

function linkedSessionIds(planId: string): string[] {
  return getDb()
    .select({ sessionLocalId: planSessionsTable.sessionLocalId })
    .from(planSessionsTable)
    .where(eq(planSessionsTable.planId, planId))
    .orderBy(asc(planSessionsTable.addedAt))
    .all()
    .map((r) => r.sessionLocalId)
}

// Draft sessions have no row yet; linking one would violate the foreign key.
export function linkSessionToPlan(planId: string, sessionLocalId: string, stepId: string | null = null): void {
  const db = getDb()
  const exists = db.select({ id: sessionsTable.localId }).from(sessionsTable)
    .where(eq(sessionsTable.localId, sessionLocalId)).get()
  if (!exists) return
  db
    .insert(planSessionsTable)
    .values({ planId, sessionLocalId, stepId, addedAt: Date.now() })
    .onConflictDoUpdate({
      target: [planSessionsTable.planId, planSessionsTable.sessionLocalId],
      set: { stepId },
    })
    .run()
}

function syncLinkedSessions(planId: string, sessionIds: string[]): void {
  const current = new Set(linkedSessionIds(planId))
  const wanted = new Set(sessionIds)
  const removed = [...current].filter((id) => !wanted.has(id))
  if (removed.length > 0) {
    getDb().delete(planSessionsTable)
      .where(and(eq(planSessionsTable.planId, planId), inArray(planSessionsTable.sessionLocalId, removed)))
      .run()
  }
  for (const id of sessionIds) {
    if (!current.has(id)) linkSessionToPlan(planId, id)
  }
}

export async function createPlan(
  projectPath: string,
  data: PlansCreateInput,
): Promise<Plan> {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  await db.insert(plansTable).values({
    id,
    projectId: projectPath,
    sessionId: null,
    brief: data.brief ?? null,
    workItemSourceId: data.workItem?.sourceId ?? null,
    workItemId: data.workItem?.itemId ?? null,
    workItemExternalRef: data.workItem?.externalRef ?? null,
    workItemTitle: data.workItem?.title ?? null,
    planRef: data.planRef ?? null,
    title: data.title,
    prompt: data.prompt ?? null,
    status: data.status ?? 'planned',
    planningModel: null,
    estimatedMinutes: data.estimatedMinutes ?? 0,
    agencyId: data.agencyId ?? null,
    agencyScope: data.agencyScope ?? null,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    completedAt: null,
  })

  const stepRows = (data.steps ?? []).map((s, i) => ({
    id: randomUUID(),
    planId: id,
    position: i,
    title: s.title,
    summary: s.summary ?? null,
    instructions: s.instructions ?? null,
    filesInScope: JSON.stringify(s.filesInScope ?? []),
    model: s.model,
    agent: s.agent,
    estimatedMinutes: s.estimatedMinutes ?? 0,
    actualMinutes: s.actualMinutes ?? null,
    status: s.status ?? 'pending',
    parallel: s.parallel ? 1 : 0,
    requiresApproval: s.requiresApproval ? 1 : 0,
    context: s.context ?? null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
  }))

  if (stepRows.length > 0) {
    await db.insert(planStepsTable).values(stepRows)
  }

  syncLinkedSessions(id, data.sessionIds ?? [])

  const planRow = await db.query.plans.findFirst({ where: eq(plansTable.id, id) })
  const stepRowsFresh = await db.query.planSteps.findMany({ where: eq(planStepsTable.planId, id) })
  broadcastPlanUpdated(projectPath, id)
  return rowToPlan(planRow!, stepRowsFresh, linkedSessionIds(id))
}

export async function updatePlan(
  projectPath: string,
  id: string,
  patch: PlansUpdateInput,
): Promise<Plan | null> {
  const db = getDb()
  const existing = await db.query.plans.findFirst({
    where: and(eq(plansTable.id, id), eq(plansTable.projectId, projectPath)),
  })
  if (!existing) return null

  const now = Date.now()

  // Atomic single-step patch path (execution hot path)
  if (patch.stepId !== undefined) {
    const sp = patch.stepPatch as PlansStepPatch | undefined
    if (sp) {
      const stepUpdate: Partial<typeof planStepsTable.$inferInsert> = {}
      if (sp.status !== undefined) stepUpdate.status = sp.status
      if (sp.startedAt !== undefined) stepUpdate.startedAt = sp.startedAt
      if (sp.completedAt !== undefined) stepUpdate.completedAt = sp.completedAt
      if (sp.failedAt !== undefined) stepUpdate.failedAt = sp.failedAt
      if (sp.actualMinutes !== undefined) stepUpdate.actualMinutes = sp.actualMinutes
      if (Object.keys(stepUpdate).length > 0) {
        await db.update(planStepsTable)
          .set(stepUpdate)
          .where(and(eq(planStepsTable.id, patch.stepId), eq(planStepsTable.planId, id)))
      }
    }
    await db.update(plansTable).set({ updatedAt: now }).where(eq(plansTable.id, id))
    broadcastPlanUpdated(projectPath, id)
    return getPlan(projectPath, id)
  }

  // Full step replace path (re-plan)
  if (patch.steps !== undefined) {
    db.transaction((tx) => {
      tx.delete(planStepsTable).where(eq(planStepsTable.planId, id)).run()
      const newRows = patch.steps!.map((s, i) => ({
        id: randomUUID(),
        planId: id,
        position: i,
        title: s.title,
        summary: s.summary ?? null,
        instructions: s.instructions ?? null,
        filesInScope: JSON.stringify(s.filesInScope ?? []),
        model: s.model,
        agent: s.agent,
        estimatedMinutes: s.estimatedMinutes ?? 0,
        actualMinutes: s.actualMinutes ?? null,
        status: s.status ?? 'pending',
        parallel: s.parallel ? 1 : 0,
        requiresApproval: s.requiresApproval ? 1 : 0,
        context: s.context ?? null,
        startedAt: null,
        completedAt: null,
        failedAt: null,
      }))
      if (newRows.length > 0) {
        tx.insert(planStepsTable).values(newRows).run()
      }
    })
  }

  // Plan-level field updates
  const planUpdate: Partial<typeof plansTable.$inferInsert> = { updatedAt: now }
  if (patch.status !== undefined) planUpdate.status = patch.status
  if (patch.estimatedMinutes !== undefined) planUpdate.estimatedMinutes = patch.estimatedMinutes
  if (patch.sessionIds !== undefined) syncLinkedSessions(id, patch.sessionIds)
  if (patch.brief !== undefined) planUpdate.brief = patch.brief || null
  if (patch.prompt !== undefined) planUpdate.prompt = patch.prompt
  if (patch.title !== undefined) planUpdate.title = patch.title
  if (patch.workItem !== undefined) {
    planUpdate.workItemSourceId = patch.workItem?.sourceId ?? null
    planUpdate.workItemId = patch.workItem?.itemId ?? null
    planUpdate.workItemExternalRef = patch.workItem?.externalRef ?? null
    planUpdate.workItemTitle = patch.workItem?.title ?? null
  }
  if (patch.agencyId !== undefined) planUpdate.agencyId = patch.agencyId ?? null
  if (patch.agencyScope !== undefined) planUpdate.agencyScope = patch.agencyScope ?? null

  await db.update(plansTable).set(planUpdate).where(eq(plansTable.id, id))

  broadcastPlanUpdated(projectPath, id)
  return getPlan(projectPath, id)
}

export async function listPlans(projectPath: string): Promise<Plan[]> {
  const db = getDb()
  const rows = await db.query.plans.findMany({
    where: eq(plansTable.projectId, projectPath),
  })
  const result: Plan[] = []
  for (const row of rows) {
    const steps = await db.query.planSteps.findMany({ where: eq(planStepsTable.planId, row.id) })
    result.push(rowToPlan(row, steps, linkedSessionIds(row.id)))
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getPlan(projectPath: string, id: string): Promise<Plan | null> {
  const db = getDb()
  const row = await db.query.plans.findFirst({
    where: and(eq(plansTable.id, id), eq(plansTable.projectId, projectPath)),
  })
  if (!row) return null
  const steps = await db.query.planSteps.findMany({ where: eq(planStepsTable.planId, id) })
  return rowToPlan(row, steps, linkedSessionIds(id))
}

/** Most recently linked plan for a session, regardless of project. */
export function planIdForSession(sessionLocalId: string): string | null {
  const row = getDb()
    .select({ planId: planSessionsTable.planId })
    .from(planSessionsTable)
    .where(eq(planSessionsTable.sessionLocalId, sessionLocalId))
    .orderBy(asc(planSessionsTable.addedAt))
    .all()
    .at(-1)
  return row?.planId ?? null
}

export async function getPlanByRef(projectPath: string, planRef: string): Promise<{ id: string } | null> {
  const db = getDb()
  const row = await db.query.plans.findFirst({
    where: and(eq(plansTable.planRef, planRef), eq(plansTable.projectId, projectPath)),
  })
  return row ? { id: row.id } : null
}

export async function deletePlan(projectPath: string, id: string): Promise<boolean> {
  const db = getDb()
  const existing = await db.query.plans.findFirst({
    where: and(eq(plansTable.id, id), eq(plansTable.projectId, projectPath)),
  })
  if (!existing) return false
  await db.delete(plansTable).where(eq(plansTable.id, id))
  return true
}

// Intentionally leaves plan status and step statuses untouched. General sessions
// have no project, hence no plans.
export async function removeSessionFromPlans(projectPath: string | null, sessionLocalId: string): Promise<void> {
  if (!projectPath) return
  getDb().delete(planSessionsTable).where(eq(planSessionsTable.sessionLocalId, sessionLocalId)).run()
}

export async function removeAllSessionsFromPlans(projectPath: string | null): Promise<void> {
  if (!projectPath) return
  const db = getDb()
  const planIds = db.select({ id: plansTable.id }).from(plansTable)
    .where(eq(plansTable.projectId, projectPath)).all().map((r) => r.id)
  if (planIds.length === 0) return
  db.delete(planSessionsTable).where(inArray(planSessionsTable.planId, planIds)).run()
}

export function broadcastPlanUpdated(projectPath: string, id: string): void {
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send(IPC_CHANNELS.planUpdated, { projectPath, id }),
  )
}
