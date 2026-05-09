import { eq } from 'drizzle-orm'
import { getDb } from './db/index'
import { sessionStats, appState } from './db/schema'

export interface SessionStatRow {
  sessionLocalId: string
  totalTokens: number
  totalCostUsd: number
  turnCount: number
  inProgressTokens: number
}

export function getAllStats(): SessionStatRow[] {
  return getDb().select().from(sessionStats).all().map((r) => ({
    sessionLocalId: r.sessionLocalId,
    totalTokens: r.totalTokens,
    totalCostUsd: r.totalCostUsd,
    turnCount: r.turnCount,
    inProgressTokens: r.inProgressTokens,
  }))
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

export function isStatsImported(): boolean {
  return !!getDb().select().from(appState).where(eq(appState.key, 'statsImported')).get()
}

export function markStatsImported(): void {
  getDb().insert(appState).values({ key: 'statsImported', value: '1' })
    .onConflictDoNothing().run()
}
