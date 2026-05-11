import { eq } from 'drizzle-orm'
import { getDb } from './db/index'
import { costEntries } from './db/schema'

export interface CostEntry {
  key: string
  date: string        // YYYY-MM-DD
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
  costUsd: number
  recordedAt: string  // ISO timestamp
}

export interface DayTotal {
  date: string
  costUsd: number
  tokens: number
}

// Kept to avoid changing index.ts call sites.
export function init(_userDataPath: string): void {}

export function hasEntry(key: string): boolean {
  return !!getDb().select({ key: costEntries.key }).from(costEntries).where(eq(costEntries.key, key)).get()
}

// No-op if key already recorded — cost is frozen at computation time.
export function recordEntry(entry: CostEntry): void {
  getDb().insert(costEntries).values({
    key: entry.key,
    date: entry.date,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheCreationTokens: entry.cacheCreationTokens,
    inputCostUsd: entry.inputCostUsd,
    outputCostUsd: entry.outputCostUsd,
    cacheReadCostUsd: entry.cacheReadCostUsd,
    cacheCreationCostUsd: entry.cacheCreationCostUsd,
    costUsd: entry.costUsd,
    recordedAt: entry.recordedAt,
  }).onConflictDoNothing().run()
}

// Kept so index.ts before-quit handler compiles without changes.
export function flush(): void {}

export interface SessionTokenBreakdown {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
}

// Aggregate per-type token counts from cost entries, grouped by session local ID.
// Cost entry keys follow the pattern `<sessionLocalId>:turn:<n>`; legacy entries
// use `legacy:<date>` and are skipped.
export function getSessionTokenBreakdowns(): Record<string, SessionTokenBreakdown> {
  const rows = getDb().select({
    key: costEntries.key,
    inputTokens: costEntries.inputTokens,
    outputTokens: costEntries.outputTokens,
    cacheReadTokens: costEntries.cacheReadTokens,
    cacheCreationTokens: costEntries.cacheCreationTokens,
    inputCostUsd: costEntries.inputCostUsd,
    outputCostUsd: costEntries.outputCostUsd,
    cacheReadCostUsd: costEntries.cacheReadCostUsd,
    cacheCreationCostUsd: costEntries.cacheCreationCostUsd,
  }).from(costEntries).all()

  const result: Record<string, SessionTokenBreakdown> = {}
  for (const row of rows) {
    const turnIdx = row.key.indexOf(':turn:')
    if (turnIdx === -1) continue
    const sessionId = row.key.slice(0, turnIdx)
    if (!result[sessionId]) {
      result[sessionId] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
    }
    result[sessionId]!.inputTokens += row.inputTokens
    result[sessionId]!.outputTokens += row.outputTokens
    result[sessionId]!.cacheReadTokens += row.cacheReadTokens
    result[sessionId]!.cacheCreationTokens += row.cacheCreationTokens
    result[sessionId]!.inputCostUsd += row.inputCostUsd
    result[sessionId]!.outputCostUsd += row.outputCostUsd
    result[sessionId]!.cacheReadCostUsd += row.cacheReadCostUsd
    result[sessionId]!.cacheCreationCostUsd += row.cacheCreationCostUsd
  }
  return result
}

export function getDailySummary(): DayTotal[] {
  const rows = getDb().select().from(costEntries).all()
  const days: Record<string, DayTotal> = {}
  for (const entry of rows) {
    if (!days[entry.date]) days[entry.date] = { date: entry.date, costUsd: 0, tokens: 0 }
    days[entry.date]!.costUsd += entry.costUsd
    days[entry.date]!.tokens += entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date))
}

// Bulk-import legacy per-day totals stored in renderer's localStorage
// before the ledger was introduced. Key prefix "legacy:" prevents collision.
export function addLegacyEntry(date: string, tokens: number, costUsd: number): void {
  const key = `legacy:${date}`
  getDb().insert(costEntries).values({
    key,
    date,
    model: 'legacy-import',
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd,
    recordedAt: new Date().toISOString(),
  }).onConflictDoNothing().run()
}
