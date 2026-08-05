import { getDb } from './db/index'
import { sessions, sessionStats, plans, planSteps } from './db/schema'
import type { CostPerWorkItem, PerformanceSummary } from '../shared/ipc-contract'

export function getPerformanceSummary(opts: { projectPath: string | null; rangeDays: number }): PerformanceSummary {
  const { projectPath, rangeDays } = opts
  const cutoff = Date.now() - rangeDays * 86400_000

  const allSessions = getDb().select().from(sessions).all()
  const allStats = getDb().select().from(sessionStats).all()
  const allPlans = getDb().select().from(plans).all()
  const allPlanSteps = getDb().select().from(planSteps).all()

  const filteredSessions = allSessions.filter(
    (s) =>
      s.startedAt >= cutoff &&
      (projectPath == null || s.projectPath === projectPath),
  )

  const sessionIds = new Set(filteredSessions.map((s) => s.localId))

  const statsById: Record<string, (typeof allStats)[0]> = {}
  for (const st of allStats) {
    if (sessionIds.has(st.sessionLocalId)) statsById[st.sessionLocalId] = st
  }

  const sessionCount = filteredSessions.length

  const durations = filteredSessions.map((s) => (s.lastActivityAt - s.startedAt) / 60000)

  const avgDurationMinutes =
    sessionCount > 0 ? durations.reduce((a, b) => a + b, 0) / sessionCount : 0

  const medianDurationMinutes = (() => {
    if (sessionCount === 0) return 0
    const sorted = [...durations].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1
      ? sorted[mid]!
      : (sorted[mid - 1]! + sorted[mid]!) / 2
  })()

  const outcomes = { completed: 0, error: 0, inactive: 0 }
  for (const s of filteredSessions) {
    if (s.status === 'completed') outcomes.completed++
    else if (s.status === 'error') outcomes.error++
    else if (s.status === 'inactive') outcomes.inactive++
  }
  const errorRate = sessionCount > 0 ? outcomes.error / sessionCount : 0

  const totalTurns = filteredSessions.reduce(
    (sum, s) => sum + (statsById[s.localId]?.turnCount ?? 0),
    0,
  )
  const avgTurnsPerSession = sessionCount > 0 ? totalTurns / sessionCount : 0

  const totalCostUsd = filteredSessions.reduce(
    (sum, s) => sum + (statsById[s.localId]?.totalCostUsd ?? 0),
    0,
  )
  const avgCostPerSessionUsd = sessionCount > 0 ? totalCostUsd / sessionCount : 0

  const workItemMap: Record<string, { title: string | null; cost: number }> = {}
  for (const s of filteredSessions) {
    if (!s.workItemKey) continue
    const cost = statsById[s.localId]?.totalCostUsd ?? 0
    if (!workItemMap[s.workItemKey]) {
      workItemMap[s.workItemKey] = { title: s.workItemTitle ?? null, cost: 0 }
    }
    workItemMap[s.workItemKey]!.cost += cost
  }
  const costPerWorkItem: CostPerWorkItem[] = Object.entries(workItemMap)
    .filter(([, v]) => v.cost > 0)
    .map(([key, v]) => ({ workItemKey: key, workItemTitle: v.title, totalCostUsd: v.cost }))

  const filteredPlans = allPlans.filter(
    (p) =>
      p.createdAt >= cutoff && (projectPath == null || p.projectId === projectPath),
  )
  const planCount = filteredPlans.length
  const planIds = new Set(filteredPlans.map((p) => p.id))
  const completePlanCount = filteredPlans.filter((p) => p.status === 'complete').length
  const planCompleteRate = planCount > 0 ? completePlanCount / planCount : 0

  const filteredSteps = allPlanSteps.filter((s) => planIds.has(s.planId))
  const totalSteps = filteredSteps.length
  const completeSteps = filteredSteps.filter((s) => s.status === 'complete').length
  const stepCompleteRate = totalSteps > 0 ? completeSteps / totalSteps : 0
  const failedStepCount = filteredSteps.filter((s) => s.status === 'failed').length

  const stepsWithActual = filteredSteps.filter((s) => s.actualMinutes != null)
  const estimateAccuracy = (() => {
    if (stepsWithActual.length === 0) return 0
    const sumActual = stepsWithActual.reduce((sum, s) => sum + (s.actualMinutes ?? 0), 0)
    const sumEstimated = stepsWithActual.reduce((sum, s) => sum + s.estimatedMinutes, 0)
    return sumEstimated > 0 ? sumActual / sumEstimated : 0
  })()

  return {
    sessionCount,
    avgDurationMinutes,
    medianDurationMinutes,
    outcomes,
    errorRate,
    avgTurnsPerSession,
    totalCostUsd,
    avgCostPerSessionUsd,
    costPerWorkItem,
    planCount,
    planCompleteRate,
    stepCompleteRate,
    failedStepCount,
    estimateAccuracy,
  }
}
