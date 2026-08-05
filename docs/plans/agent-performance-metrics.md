# Agent Performance Metrics Plan

Add operational performance metrics — average session duration, cost per
session/task, and plan success rate — to the Sessions overview. Query-layer
only: everything is computed from data already persisted in SQLite, with no
new runtime instrumentation.

---

## Context

The Sessions overview currently shows live telemetry (Active Sessions,
Running Agents, Token Activity, Cache Efficiency) but nothing about how long
sessions take, what work costs per task, or whether the work actually
succeeded. Three high-value metrics are computable today:

| Metric | Data source | Caveat |
|--------|-------------|--------|
| Avg session duration | `sessions.startedAt` / `lastActivityAt` / `status` | No `endedAt` column — proxy with `lastActivityAt` on closed sessions |
| Cost per session / task | `sessionStats.totalCostUsd` + `sessions.workItemKey` / `workItemTitle` | Work-item cost only exists for sessions launched from a plugin work item |
| Plan success rate | `plans.status`, `planSteps.status` / `failedAt` / `actualMinutes` | `failed` steps are the granular failure signal |

Definitions and constraints:

- **Closed session** = `status ∈ {completed, error, inactive}`. `inactive`
  means the app quit mid-run (`resetStaleRunning`, session-registry.ts:309);
  `lastActivityAt` still approximates the end. Still-open sessions
  (`running`/`idle`/`blocked`/etc.) are excluded from duration stats.
- **Duration proxy** = `lastActivityAt - startedAt` for closed sessions.
  Acceptable skew: sessions resumed over multiple days. If we want exact
  timing later, add an `endedAt` column (Phase 3, optional).
- **History bound**: persisted sessions are capped at 100 per project
  (`SESSION_CAP`, session-registry.ts:7), so "average" means "last ~100
  sessions per project."
- **Response time, human intervention, and true task success are out of
  scope** — they require new persisted instrumentation (see Deferred).

---

## Phase 0 — Performance summary query (½ day)

New module `apps/desktop/src/main/performance.ts` with a single entry point:

```ts
getPerformanceSummary(opts: { projectPath: string | null; rangeDays: number }): PerformanceSummary
```

Returns a structured summary computed from three tables:

```ts
export interface PerformanceSummary {
  rangeDays: number
  // Sessions (closed, within range)
  sessionCount: number
  avgDurationMinutes: number | null
  medianDurationMinutes: number | null
  outcomes: { completed: number; error: number; inactive: number }
  errorRate: number | null                      // error / sessionCount
  avgTurnsPerSession: number | null             // sessionStats.turnCount join
  // Cost
  totalCostUsd: number
  avgCostPerSessionUsd: number | null
  costPerWorkItem: Array<{
    key: string; title: string | null; costUsd: number; sessionCount: number
  }>
  // Plans (created within range)
  planCount: number
  planCompleteRate: number | null               // 'complete' / total
  stepCompleteRate: number | null               // steps 'complete' / started steps
  failedStepCount: number                       // steps 'failed'
  estimateAccuracy: number | null               // ΣactualMinutes / ΣestimatedMinutes (steps with actualMinutes)
}
```

**Tasks**
- [ ] Query `sessions` (+ `sessionStats` left join on `localId`) filtered by
      project and `startedAt >= cutoff`; restrict duration/outcome math to
      closed statuses; compute avg + median duration, outcome counts, error
      rate, avg turns.
- [ ] Cost rollups: sum `sessionStats.totalCostUsd`; per work item, group by
      `sessions.workItemKey` (skip null keys, keep only items with cost > 0).
- [ ] Plans: count by `plans.status` and `createdAt >= cutoff`; step stats
      from `planSteps` (complete vs started, failed count, estimate ratio).
- [ ] Follow the `getDailySummaryByProject` precedent (cost-ledger.ts:155)
      for the project-scoped query shape and null-safe rollups.

**Outcome**: `getPerformanceSummary` returns all three metric families for a
project scope and time range, computed entirely from SQLite.

---

## Phase 1 — IPC plumbing (¼ day)

Follow the standard four-file path.

**Tasks**
- [ ] `shared/ipc-contract.ts`: add `PerformanceSummary` interface and
      `IPC_CHANNELS.performanceGetSummary`, plus the API method on
      `AgentKeeperApi` (e.g. `performance.getSummary(opts)`).
- [ ] `main/ipc.ts`: register `ipcMain.handle` for the channel, delegating to
      `performance.ts`.
- [ ] `preload/index.ts`: expose `window.agentkeeper.performance.getSummary`.
- [ ] `renderer/src/lib/queryKeys.ts`: add
      `performance.summary(projectPath, rangeDays)` key family.

**Outcome**: Renderer can fetch the summary over IPC with typed returns.

---

## Phase 2 — Renderer UI (½ day)

Add a `PerformanceSection` under `StatsCards` on the Sessions view, scoped to
the existing project filter (`selectedProjectPath`).

**Tasks**
- [ ] `composables/usePerformanceQuery.ts` — `useQuery` wrapper over
      `window.agentkeeper.performance.getSummary`, keyed by project + range
      (default 30 days), 60s stale time (matches `useDailyCostsQuery`).
- [ ] `components/PerformanceSection.vue`:
  - Three stat cards: **Avg Duration** (`12m 30s`), **Cost / Session**
    (`$1.24`), **Plan Completion** (`68%`), each with a secondary line
    (median duration, error rate, failed steps).
  - A small **Cost per task** table (work-item key, title, cost) shown only
    when linked work items exist; empty state otherwise.
  - Empty state for the whole section when `sessionCount === 0`.
- [ ] `lib/format.ts`: add `formatDuration(minutes)` helper (e.g.
      `12m 30s`, `1h 4m`).
- [ ] Wire into `SessionsView.vue` below `<StatsCards :project-path="..." />`
      (SessionsView.vue:476).

**Outcome**: Users see per-project duration, cost, and plan-success numbers on
the Sessions overview with no new data collection.

---

## Phase 3 — Optional: exact `endedAt` (¼ day, deferred)

If the `lastActivityAt` duration proxy proves too skewed for resumed
multi-day sessions, add an explicit end timestamp.

**Tasks**
- [ ] Migration `0014_sessions_ended_at.sql`: `ALTER TABLE sessions ADD COLUMN
      ended_at INTEGER;` then backfill `ended_at = last_activity_at` for rows
      whose status is `completed`/`error`/`inactive`.
- [ ] `db/schema.ts`: add `endedAt` column; update `Session` type +
      `rowToSession`.
- [ ] Persist it: the agent status funnel is `setStatus()` (agent.ts:217);
      session-level terminal transitions flow through `updateSession`. Set
      `endedAt` once when the rolled-up session status becomes terminal
      (note `TERMINAL_STATUSES` includes `idle`/`suspended` — only stamp on
      `completed`/`error`/`inactive`).
- [ ] Switch `performance.ts` to prefer `endedAt` when present, fall back to
      `lastActivityAt`.

**Outcome**: Duration is exact. Skipping this phase keeps the whole feature
schema-free.

---

## Deferred / out of scope

- **Response time (turn latency)** — `currentTurnStartedAt`/`EndedAt` are
  renderer-memory only (stores/sessions.ts:1396); needs a persisted
  per-turn timing row written in main.
- **Human intervention** — interrupts and `askUser` blocks are in-memory
  only; needs an `interventions` event table.
- **True task success** — no verdict exists; requires agent self-report, a
  post-session LLM judge, or a merged-PR signal.

---

## Sequencing

```
Phase 0 (query) ──► Phase 1 (IPC) ──► Phase 2 (UI)
                                            │
                                            └──► Phase 3 (optional, deferred)
```

Phases 0–2 are a single linear slice in one worktree, commit-ready as one
feature. Phase 3 is a follow-up only if the proxy duration is unacceptable.

---

## Files touched (summary)

| File | Change |
|------|--------|
| `apps/desktop/src/main/performance.ts` | New — `getPerformanceSummary()` |
| `apps/desktop/src/shared/ipc-contract.ts` | `PerformanceSummary` type + channel + API method |
| `apps/desktop/src/main/ipc.ts` | Register `performance:getSummary` handler |
| `apps/desktop/src/preload/index.ts` | Expose `performance.getSummary` |
| `apps/desktop/src/renderer/src/lib/queryKeys.ts` | Add `performance.summary` key |
| `apps/desktop/src/renderer/src/lib/format.ts` | Add `formatDuration()` |
| `apps/desktop/src/renderer/src/composables/usePerformanceQuery.ts` | New — query wrapper |
| `apps/desktop/src/renderer/src/components/PerformanceSection.vue` | New — UI section |
| `apps/desktop/src/renderer/src/views/SessionsView.vue` | Render `PerformanceSection` |
| *(Phase 3)* `apps/desktop/src/main/db/migrations/0014_*.sql` | `ended_at` column + backfill |
| *(Phase 3)* `apps/desktop/src/main/session-registry.ts` | Stamp `endedAt` on terminal status |
