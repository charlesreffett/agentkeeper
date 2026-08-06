import { eq, like } from 'drizzle-orm'
import { getDb } from './db/index'
import { agents, costEntries, sessions } from './db/schema'

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
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface ProjectDayTotal extends DayTotal {
  projectPath: string
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

  const byAgent: Record<string, SessionTokenBreakdown> = {}
  for (const row of rows) {
    const turnIdx = row.key.indexOf(':turn:')
    if (turnIdx === -1) continue
    const agentId = row.key.slice(0, turnIdx)
    if (!byAgent[agentId]) {
      byAgent[agentId] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
    }
    byAgent[agentId]!.inputTokens += row.inputTokens
    byAgent[agentId]!.outputTokens += row.outputTokens
    byAgent[agentId]!.cacheReadTokens += row.cacheReadTokens
    byAgent[agentId]!.cacheCreationTokens += row.cacheCreationTokens
    byAgent[agentId]!.inputCostUsd += row.inputCostUsd
    byAgent[agentId]!.outputCostUsd += row.outputCostUsd
    byAgent[agentId]!.cacheReadCostUsd += row.cacheReadCostUsd
    byAgent[agentId]!.cacheCreationCostUsd += row.cacheCreationCostUsd
  }

  const agentRows = getDb().select({ localId: agents.localId, sessionLocalId: agents.sessionLocalId }).from(agents).all()
  const agentToSession: Record<string, string> = {}
  for (const a of agentRows) agentToSession[a.localId] = a.sessionLocalId

  const bySession: Record<string, SessionTokenBreakdown> = {}
  for (const [agentId, b] of Object.entries(byAgent)) {
    const sessionId = agentToSession[agentId] ?? agentId
    if (!bySession[sessionId]) {
      bySession[sessionId] = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
    }
    bySession[sessionId]!.inputTokens += b.inputTokens
    bySession[sessionId]!.outputTokens += b.outputTokens
    bySession[sessionId]!.cacheReadTokens += b.cacheReadTokens
    bySession[sessionId]!.cacheCreationTokens += b.cacheCreationTokens
    bySession[sessionId]!.inputCostUsd += b.inputCostUsd
    bySession[sessionId]!.outputCostUsd += b.outputCostUsd
    bySession[sessionId]!.cacheReadCostUsd += b.cacheReadCostUsd
    bySession[sessionId]!.cacheCreationCostUsd += b.cacheCreationCostUsd
  }
  return bySession
}

export function getAgentTurnCount(agentLocalId: string): number {
  return getDb()
    .select({ key: costEntries.key })
    .from(costEntries)
    .where(like(costEntries.key, `${agentLocalId}:turn:%`))
    .all()
    .length
}

export function getDailySummary(): DayTotal[] {
  const rows = getDb().select().from(costEntries).all()
  const days: Record<string, DayTotal> = {}
  for (const entry of rows) {
    if (!days[entry.date]) days[entry.date] = { date: entry.date, costUsd: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    days[entry.date]!.costUsd += entry.costUsd
    days[entry.date]!.inputTokens += entry.inputTokens
    days[entry.date]!.outputTokens += entry.outputTokens
    days[entry.date]!.cacheReadTokens += entry.cacheReadTokens
    days[entry.date]!.cacheCreationTokens += entry.cacheCreationTokens
    days[entry.date]!.tokens += entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date))
}

// Per-day totals split by owning project. Cost entry keys are
// `<agentLocalId>:turn:<n>`; join agent → session → project_path to attribute
// each entry. Legacy entries (`legacy:` prefix) carry no project and are
// dropped from this breakdown.
export function getDailySummaryByProject(): ProjectDayTotal[] {
  const costRows = getDb().select().from(costEntries).all()
  const agentRows = getDb().select({ localId: agents.localId, sessionLocalId: agents.sessionLocalId }).from(agents).all()
  const sessionRows = getDb().select({ localId: sessions.localId, projectPath: sessions.projectPath }).from(sessions).all()

  const agentToSession: Record<string, string> = {}
  for (const a of agentRows) agentToSession[a.localId] = a.sessionLocalId
  const sessionToProject: Record<string, string | null> = {}
  for (const s of sessionRows) sessionToProject[s.localId] = s.projectPath

  const byKey: Record<string, ProjectDayTotal> = {}
  for (const entry of costRows) {
    const turnIdx = entry.key.indexOf(':turn:')
    if (turnIdx === -1) continue
    const agentId = entry.key.slice(0, turnIdx)
    const sessionId = agentToSession[agentId] ?? agentId
    const projectPath = sessionToProject[sessionId]
    if (!projectPath) continue
    const k = `${projectPath}\n${entry.date}`
    if (!byKey[k]) byKey[k] = { projectPath, date: entry.date, costUsd: 0, tokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    const d = byKey[k]!
    d.costUsd += entry.costUsd
    d.inputTokens += entry.inputTokens
    d.outputTokens += entry.outputTokens
    d.cacheReadTokens += entry.cacheReadTokens
    d.cacheCreationTokens += entry.cacheCreationTokens
    d.tokens += entry.inputTokens + entry.outputTokens + entry.cacheReadTokens + entry.cacheCreationTokens
  }
  return Object.values(byKey)
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
