# TanStack Query Migration Plan

## Overview

Migrate the renderer-side data access layer from hand-rolled Pinia stores to
`@tanstack/vue-query` (TSQ) for all "dead" (fetch/cache/display) data. Live
streaming session state stays in Pinia — only the CRUD/list half moves.

## Branch strategy

All work happens on a dedicated branch: `feat/tanstack-query`.

**Do not merge to `main` until every phase is complete, all views are tested
against the real Electron app, and no regressions are observed in:**
- Session list load and display
- Agency/role save, edit, delete
- Pricing refresh
- Settings persistence
- Daily cost/stats display
- Session start, streaming events, token counters (must be unaffected)

The branch stays open until the above is confirmed. If any phase reveals an
unacceptable trade-off, the branch is abandoned — `main` is never touched.

## Data model split (non-negotiable)

| Data type | Destination | Rationale |
|-----------|-------------|-----------|
| Projects, agencies, roles | TSQ | Pure fetch + CRUD |
| Settings, secrets, pricing | TSQ | Rarely mutate; benefit from stale-while-revalidate |
| Sessions list (persisted + historical) | TSQ | Deduplication needed across views |
| Daily costs, session stats (read) | TSQ | Cacheable aggregates; expensive to recompute |
| Live session state (events, tokens, status) | Pinia | Push-based streaming; not cacheable |
| Agency handoff runtime | Pinia | Stateful machine; not cacheable |
| Draft text/attachments | Pinia | Ephemeral; lives and dies with the session |

**Convention enforced throughout: if it streams or accumulates → Pinia.
If it's a query → TSQ. No exceptions added without updating this doc.**

---

## Phase 1 — Infrastructure

**Goal**: Stand up TSQ without touching any existing store or component.

### Tasks
1. Install `@tanstack/vue-query` (Vue 3 adapter) via pnpm.
2. Create `apps/desktop/src/renderer/src/lib/queryClient.ts`:
   - Default `staleTime: 30_000` (matches IPC round-trip expectations)
   - Default `gcTime: 5 * 60_000`
   - `retry: 1` (IPC errors are rarely transient, don't hammer)
   - No `refetchOnWindowFocus` by default — opt-in per query
3. Create `apps/desktop/src/renderer/src/lib/queryKeys.ts`:
   - Centralized key factory for every IPC endpoint that will be migrated
   - Shape: `queryKeys.projects.list()`, `queryKeys.agencies.list(projectPath)`, etc.
4. Register `VueQueryPlugin` in `apps/desktop/src/renderer/src/main.ts`.
5. Add `@tanstack/vue-query` DevTools (renderer-only, dev mode guard).

**Exit criteria**: App boots, DevTools panel visible, no existing behaviour changed.

---

## Phase 2 — Small stores (prove the pattern)

**Goal**: Replace the three simplest stores with TSQ composables. Validate the
convention before touching anything load-bearing.

### Stores replaced
- `usePricingStore` → `usePricingQuery` composable
- `useAppSettingsStore` → `useSettingsQuery` composable

### Tasks

#### `usePricingQuery`
- `useQuery(queryKeys.pricing.table(), () => window.agentkeeper.pricing.getTable())`
  - `staleTime: Infinity` (pricing only changes on explicit refresh)
- `useMutation` for `pricing.refresh()` with `invalidateQueries(queryKeys.pricing.table())`
- Delete `stores/pricing.ts` once no component imports it

#### `useSettingsQuery`
- `useQueries` with 3 parallel IPC calls:
  1. `settings.get()`
  2. `secrets.has('anthropicApiKey')`
  3. `github.getConfig()`
- Single combined `data` object returned from composable
- `useMutation` per settings key with targeted invalidation
- Delete `stores/appSettings.ts` once no component imports it

### Convention decision (locked in here)
Components import the composable directly. No Pinia wrapper. Example:

```ts
// Before
const store = useAppSettingsStore()
onMounted(() => store.load())
const theme = computed(() => store.settings.theme)

// After
const { data: settings } = useSettingsQuery()
const theme = computed(() => settings.value?.theme)
```

**Exit criteria**: Settings and pricing views function identically. DevTools
confirms cache hits on repeated navigation. No `load()` calls remain for these stores.

---

## Phase 3 — Agencies and roles

**Goal**: Replace `useAgenciesStore` and `useRolesDataStore` with TSQ. This
eliminates the `loadGeneration` counter hack and the `loadAll()` after every
mutation.

### Tasks

#### `useAgenciesQuery(projectPath)`
- `useQuery(queryKeys.agencies.list(projectPath), () => window.agentkeeper.agencies.list())`
- `enabled: computed(() => !!projectPath.value)`

#### `useRolesQuery(projectPath)`
- `useQuery(queryKeys.roles.list(projectPath), () => window.agentkeeper.roles.list())`

#### Mutations (each invalidates its respective list key)
- `useSaveAgencyMutation()` → `invalidateQueries(queryKeys.agencies.list(...))`
- `useRemoveAgencyMutation()` → same
- `useSaveRoleMutation()`, `useRemoveRoleMutation()` → same for roles

#### `AgenciesView.vue` update
- Remove `store.loadAll()` on mount; remove project watch/reload
- TSQ re-fetches automatically when `projectPath` (query key) changes
- Remove `loadGeneration` counter entirely

- Delete `stores/agencies.ts` and `stores/rolesData.ts` once no imports remain

**Exit criteria**: Agency CRUD works. Creating/saving/deleting an agency
immediately reflects in the list with no manual reload call. Flow graph updates
correctly. `loadGeneration` is gone.

---

## Phase 4 — Projects

**Goal**: Replace `useProjectsStore` with TSQ.

### Tasks

#### `useProjectsQuery`
- `useQuery(queryKeys.projects.list(), () => window.agentkeeper.projects.list())`
- `useQuery(queryKeys.projects.focused(), () => window.agentkeeper.projects.getFocused())`

#### Mutations
- `useAddProjectMutation()` → invalidates `projects.list()` + `projects.focused()`
- `useRemoveProjectMutation()` → same
- `useRenameProjectMutation()` → same
- `useSetFocusedMutation()` → invalidates `projects.focused()`

- Delete `stores/projects.ts` once no imports remain

**Note**: `useProjectsStore` is consumed widely. Update all call sites
methodically — check every view and composable that imports it.

**Exit criteria**: Project add/remove/rename/focus work. Sidebar project panel
updates without manual reload.

---

## Phase 5 — Sessions list

**Goal**: Replace `useSessionsListStore` (which has hand-rolled deduplication
via `_key`/`_promise`) with TSQ fan-out queries.

### Tasks

#### `usePersistedSessionsQuery(projectPath)`
- `useQuery(queryKeys.sessions.persisted(projectPath), () => window.agentkeeper.sessions.listPersisted(projectPath))`
- One query per project; TSQ deduplicates naturally by key

#### `useHistoricalSessionsQuery(projectPath)`
- Same pattern for `sessions.list(projectPath)`

#### `useSessionsListQuery(projects)` (aggregate composable)
- `useQueries` fan-out over all project paths
- Merges results, deduplicates by localId and SDK session id (same logic as current `_doLoad`)
- Exposes `persistedSessions`, `historicalSessions`, `isLoading`

#### Invalidation hooks (called by session store after session completes)
- `invalidateQueries(queryKeys.sessions.persisted(projectPath))`
- Triggered from `useSessionStore`'s `onStatus` handler when status → `completed` or `error`

- Delete `stores/sessionsList.ts` once no imports remain

**Exit criteria**: Sessions view loads correctly across all projects. Delete
mutations immediately reflect. No `_key`/`_promise` deduplication code remains.

---

## Phase 6 — Stats bootstrapping

**Goal**: Extract the startup stats load out of `useSessionStore` into a TSQ
query. The session store subscribes to the result for initial hydration, then
streaming takes over.

### Tasks

#### `useSessionStatsQuery`
- `useQuery(queryKeys.stats.all(), () => window.agentkeeper.stats.getAll())`
- `staleTime: 60_000` (stats only change after a session completes)
- Invalidated by the same hook in Phase 5 (session complete → invalidate stats too)

#### `useDailyCostsQuery`
- `useQuery(queryKeys.costs.daily(), () => window.agentkeeper.costs.getDailySummary())`
- `staleTime: 60_000`
- Invalidated after session completes

#### `useSessionStore` changes (minimal)
- Remove the IIFE startup block that calls `stats.getAll()` and `costs.getDailySummary()`
- Replace with `watch` on `useSessionStatsQuery().data` to hydrate `sessionTokens` on first load
- `dailyUsage` dict populated from `useDailyCostsQuery().data` on first load, then kept
  live by streaming `onStats` updates (no change to streaming path)
- Legacy localStorage migration stays in the store (one-time, not worth moving)

**Exit criteria**: Sessions view shows correct historical stats on first load.
Daily usage chart populates without the store's init block. Token counters
continue to update in real time during a live session.

---

## Phase 7 — Cleanup and merge

### Tasks
1. Audit for any remaining manual `load()` / `loadAll()` calls — none should exist
   for migrated stores.
2. Remove any deleted store files from index exports.
3. Remove `@tanstack/vue-query` DevTools from production build (confirm dev guard).
4. Run `pnpm typecheck` — must pass clean.
5. Manual test pass against the live Electron app (not just Vite dev mode):
   - Boot → projects load
   - Add/remove project
   - Focus project → agencies/roles reload
   - Start a session → streaming works, tokens accumulate, stats persist
   - Navigate away and back → cache hit (no redundant IPC call in DevTools)
   - Pricing refresh
   - Settings change persists across reload
6. Merge `feat/tanstack-query` → `main` only after the above passes.

---

## What is NOT migrated (and why)

| Store / code | Reason left in Pinia |
|---|---|
| `useSessionStore` (streaming core) | Push-based IPC listeners; accumulates state over time; not a cache |
| `buffered` dict | Race-condition buffer for events that arrive before session registration |
| Partial text accumulation | In-place mutation of streaming deltas; fundamentally stateful |
| `sessionTokens`, `sessionTurns` dicts | Updated per-event, not per-request |
| Agency handoff runtime | Cross-session dependency graph; stateful |
| Draft text/attachments | Ephemeral per-session; not shared across components |

Do not migrate these in a future pass without a separate plan and deliberate
design — the streaming model is not compatible with TSQ's request/response
assumptions.

---

## Dependencies

```
@tanstack/vue-query   ^5.x   (Vue 3 adapter; pinned to major)
@tanstack/query-devtools  ^5.x  (dev only)
```

No server-side rendering concerns — Electron renderer only.

---

## Known risks

- **Import blast radius of `useProjectsStore`**: it's consumed in many views
  and composables. Phase 4 will have the most call-site churn. Migrate
  methodically, one consumer at a time.
- **`useSessionStore` bootstrap coupling**: The startup stats load is tangled
  with legacy migration logic. Phase 6 must not break the migration guard
  (`agentkeeper:statsImported` flag check).
- **IPC error shapes**: TSQ's `error` is typed as `unknown`. Create a thin
  `ipcQuery` wrapper that normalises IPC string errors into `Error` objects
  so TSQ's `isError` / `error.message` work correctly.
