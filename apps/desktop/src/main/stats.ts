import { eq } from 'drizzle-orm'
import { getDb } from './db/index'
import { sessionStats, appState } from './db/schema'
import { getSessionTokenBreakdowns } from './cost-ledger'

export interface SessionStatRow {
  sessionLocalId: string
  totalTokens: number
  totalCostUsd: number
  turnCount: number
  inProgressTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
}

export function getAllStats(): SessionStatRow[] {
  const breakdowns = getSessionTokenBreakdowns()
  return getDb().select().from(sessionStats).all().map((r) => {
    const b = breakdowns[r.sessionLocalId] ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
    return {
      sessionLocalId: r.sessionLocalId,
      totalTokens: r.totalTokens,
      totalCostUsd: r.totalCostUsd,
      turnCount: r.turnCount,
      inProgressTokens: r.inProgressTokens,
      inputTokens: b.inputTokens,
      outputTokens: b.outputTokens,
      cacheReadTokens: b.cacheReadTokens,
      cacheCreationTokens: b.cacheCreationTokens,
      inputCostUsd: b.inputCostUsd,
      outputCostUsd: b.outputCostUsd,
      cacheReadCostUsd: b.cacheReadCostUsd,
      cacheCreationCostUsd: b.cacheCreationCostUsd,
    }
  })
}

export function upsertStats(
  sessionLocalId: string,
  totalTokens: number,
  totalCostUsd: number,
  turnCount: number,
  inProgressTokens: number,
): void {
  getDb().insert(sessionStats).values({
    sessionLocalId,
    totalTokens,
    totalCostUsd,
    turnCount,
    inProgressTokens,
    updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: sessionStats.sessionLocalId,
    set: { totalTokens, totalCostUsd, turnCount, inProgressTokens, updatedAt: Date.now() },
  }).run()
}

export function getPersistedTurnCount(sessionLocalId: string): number {
  const row = getDb()
    .select({ turnCount: sessionStats.turnCount })
    .from(sessionStats)
    .where(eq(sessionStats.sessionLocalId, sessionLocalId))
    .get()
  return row?.turnCount ?? 0
}

export function isStatsImported(): boolean {
  return !!getDb().select().from(appState).where(eq(appState.key, 'statsImported')).get()
}

export function markStatsImported(): void {
  getDb().insert(appState).values({ key: 'statsImported', value: '1' })
    .onConflictDoNothing().run()
}
