import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { BrowserWindow } from 'electron'
import { getDb } from './db/index'
import { plans as plansTable, planSteps as planStepsTable } from './db/schema'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import type { Plan, PlanStep, PlansCreateInput, PlansStepPatch, PlansUpdateInput } from '../shared/ipc-contract'

function rowToPlan(
  row: typeof plansTable.$inferSelect,
  steps: (typeof planStepsTable.$inferSelect)[],
): Plan {
  return {
    id: row.id,
    planRef: row.planRef ?? undefined,
    title: row.title,
    prompt: row.prompt ?? undefined,
    externalRef: row.planRef ?? undefined,
    workItemId: row.workItemId ?? undefined,
    agencyId: row.agencyId ?? null,
    agencyScope: (row.agencyScope as Plan['agencyScope']) ?? null,
    status: row.status as Plan['status'],
    estimatedMinutes: row.estimatedMinutes,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    sessionIds: row.sessionId ? [row.sessionId] : [],
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

export async function createPlan(
  projectPath: string,
  data: PlansCreateInput,
): Promise<Plan> {
  const db = getDb()
  const id = randomUUID()
  const now = Date.now()
  const sessionId = data.sessionIds && data.sessionIds.length > 0
    ? data.sessionIds[data.sessionIds.length - 1]!
    : null

  await db.insert(plansTable).values({
    id,
    projectId: projectPath,
    sessionId,
    workItemId: data.workItemId ?? null,
    planRef: data.externalRef ?? null,
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

  const planRow = await db.query.plans.findFirst({ where: eq(plansTable.id, id) })
  const stepRowsFresh = await db.query.planSteps.findMany({ where: eq(planStepsTable.planId, id) })
  broadcastPlanUpdated(projectPath, id)
  return rowToPlan(planRow!, stepRowsFresh)
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
  if (patch.sessionIds !== undefined) {
    planUpdate.sessionId = patch.sessionIds.length > 0
      ? patch.sessionIds[patch.sessionIds.length - 1]!
      : null
  }
  if (patch.prompt !== undefined) planUpdate.prompt = patch.prompt
  if (patch.title !== undefined) planUpdate.title = patch.title
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
    result.push(rowToPlan(row, steps))
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
  return rowToPlan(row, steps)
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

// Removes the session reference from all plans in a project that cite it.
// Intentionally leaves plan status and step statuses untouched.
export async function removeSessionFromPlans(projectPath: string, sessionLocalId: string): Promise<void> {
  const db = getDb()
  await db.update(plansTable)
    .set({ sessionId: null })
    .where(and(eq(plansTable.sessionId, sessionLocalId), eq(plansTable.projectId, projectPath)))
}

// Clears all session references from every plan in the project (used on bulk delete).
export async function removeAllSessionsFromPlans(projectPath: string): Promise<void> {
  const db = getDb()
  await db.update(plansTable)
    .set({ sessionId: null })
    .where(eq(plansTable.projectId, projectPath))
}

function broadcastPlanUpdated(projectPath: string, id: string): void {
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send(IPC_CHANNELS.planUpdated, { projectPath, id }),
  )
}
