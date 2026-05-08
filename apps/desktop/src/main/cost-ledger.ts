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
    costUsd: entry.costUsd,
    recordedAt: entry.recordedAt,
  }).onConflictDoNothing().run()
}

// Kept so index.ts before-quit handler compiles without changes.
export function flush(): void {}

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
