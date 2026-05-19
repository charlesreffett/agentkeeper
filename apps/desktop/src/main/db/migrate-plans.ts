import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import type { AppDb } from './index'
import { appState, projects, plans as plansTable, planSteps as planStepsTable } from './schema'

interface LegacyPlanStep {
  id: number
  title: string
  summary?: string
  instructions?: string
  filesInScope?: string[]
  model: string
  estimatedMinutes?: number
  actualMinutes?: number
  agent: string
  parallel?: boolean
  status?: string
  requiresApproval?: boolean
  context?: string
}

interface LegacyPlan {
  externalRef?: string
  planRef?: string
  title?: string
  prompt?: string
  workItemId?: string
  status?: string
  estimatedMinutes?: number
  createdAt?: string
  updatedAt?: string
  sessionIds?: string[]
  steps?: LegacyPlanStep[]
}

export async function migrateJsonPlansToDb(db: AppDb): Promise<void> {
  const flagRow = await db.query.appState.findFirst({
    where: eq(appState.key, 'plans_migrated_v1'),
  })
  if (flagRow) return

  const projectRows = await db.query.projects.findMany()

  for (const project of projectRows) {
    const plansDir = path.join(project.path, '.agentkeeper', 'plans')
    let entries: string[]
    try {
      entries = await fs.readdir(plansDir)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      let legacy: LegacyPlan
      try {
        const raw = await fs.readFile(path.join(plansDir, entry), 'utf-8')
        legacy = JSON.parse(raw) as LegacyPlan
      } catch {
        continue
      }

      const externalRef = legacy.externalRef ?? entry.replace(/-plan\.json$/, '')

      // Skip if already imported (idempotent on plan_ref + project_id)
      const existing = await db.query.plans.findFirst({
        where: and(
          eq(plansTable.planRef, externalRef),
          eq(plansTable.projectId, project.path),
        ),
      })
      if (existing) continue

      const now = Date.now()
      const createdAt = legacy.createdAt ? Date.parse(legacy.createdAt) : now
      const updatedAt = legacy.updatedAt ? Date.parse(legacy.updatedAt) : now
      const sessionId =
        legacy.sessionIds && legacy.sessionIds.length > 0
          ? legacy.sessionIds[legacy.sessionIds.length - 1]!
          : null

      const planId = randomUUID()

      db.transaction((tx) => {
        tx.insert(plansTable).values({
          id: planId,
          projectId: project.path,
          sessionId,
          workItemId: legacy.workItemId ?? null,
          planRef: externalRef,
          title: legacy.title ?? externalRef,
          prompt: legacy.prompt ?? null,
          status: legacy.status ?? 'planned',
          planningModel: null,
          estimatedMinutes: legacy.estimatedMinutes ?? 0,
          createdAt,
          startedAt: null,
          updatedAt,
          completedAt: null,
        }).run()

        const steps = legacy.steps ?? []
        if (steps.length > 0) {
          tx.insert(planStepsTable).values(
            steps.map((s, i) => ({
              id: randomUUID(),
              planId,
              position: i,
              title: s.title ?? '',
              summary: s.summary ?? null,
              instructions: s.instructions ?? null,
              filesInScope: JSON.stringify(s.filesInScope ?? []),
              model: s.model ?? 'claude-sonnet-4-5',
              agent: s.agent ?? 'main',
              estimatedMinutes: s.estimatedMinutes ?? 0,
              actualMinutes: s.actualMinutes ?? null,
              status: s.status ?? 'pending',
              parallel: s.parallel ? 1 : 0,
              requiresApproval: s.requiresApproval ? 1 : 0,
              context: s.context ?? null,
              startedAt: null,
              completedAt: null,
              failedAt: null,
            })),
          ).run()
        }
      })
    }
  }

  await db.insert(appState).values({ key: 'plans_migrated_v1', value: '1' })
}
