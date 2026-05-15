# Session-Agent Decoupling

**Status:** Ready for implementation  
**Branch:** off `feat/tanstack-query`

## Problem

Every `sessions` DB row is a single agent run. Agency runs create N session rows sharing the same `agencyInstanceId`. The UI filters and deduplicates to avoid showing every sub-agent as a top-level session. This is fragile:

- Entry-point detection relies on `initialPrompt NOT LIKE 'Agency "%'` — a string heuristic
- Agencies can have more than one entry point; the heuristic breaks silently
- Overflow (on-demand) agents appear as separate sessions
- Adding an agent to a conversation mid-flight has no clean path

## Solution

`Session` = unit of work, always one row in the sessions list.  
`Agent` = individual Claude instance running within a session.  
A session holds 1..N agents. No filter or dedup needed in the UI.

### Invariants

- All existing session data is preserved through migration
- Solo sessions are the degenerate case (1 agent); the code path is identical
- Agency topology metadata (`agencyId`, `agencyScope`, `agencyName`) stays on the session row
- The event stream remains agent-keyed (the SDK streams per-agent); the session aggregates
- On-demand agent addition requires no agency definition

---

## Data Model

### New `agents` table

```
localId              TEXT PK
sessionLocalId       TEXT NOT NULL  →  sessions.localId  CASCADE DELETE
sdkSessionId         TEXT
roleId               TEXT
roleName             TEXT
roleInstanceIndex    INTEGER
initialPrompt        TEXT NOT NULL DEFAULT ''   -- what this agent received
isEntryPoint         INTEGER NOT NULL DEFAULT 0 -- 1 = received the user's original prompt
status               TEXT NOT NULL DEFAULT 'idle'
startedAt            INTEGER NOT NULL
lastActivityAt       INTEGER NOT NULL
```

### `sessions` table changes

Remove: `sdkSessionId`, `roleId`, `roleName`, `roleInstanceIndex`, `agencyInstanceId`  
Keep: all other columns — `agencyId`, `agencyScope`, `agencyName` stay (describe topology used)

`initialPrompt` on sessions = the user's original top-level prompt.  
`initialPrompt` on agents = what that agent actually received (differs for non-entry-point agents).

### `session_stats` table changes

Add nullable column: `agentLocalId TEXT` (null = session-level aggregate, non-null = per-agent detail)

---

## Migration 0005 — `session_agent_split`

Runs in a single SQLite transaction. Steps:

### A. DDL

```sql
CREATE TABLE agents ( ... );  -- as above
ALTER TABLE session_stats ADD COLUMN agent_local_id TEXT;
```

### B. Solo sessions (`agencyInstanceId IS NULL`)

Insert one `agents` row per session. `agents.localId = sessions.localId = agents.sessionLocalId` (same UUID — solo agent IS the session).

```sql
INSERT INTO agents (local_id, session_local_id, sdk_session_id, role_id, role_name,
  role_instance_index, initial_prompt, is_entry_point, status, started_at, last_activity_at)
SELECT local_id, local_id, sdk_session_id, role_id, role_name,
  role_instance_index, initial_prompt, 1, status, started_at, last_activity_at
FROM sessions
WHERE agency_instance_id IS NULL;
```

### C. Agency sessions

**C1.** Insert one `sessions` row per agency group with `localId = agencyInstanceId`. Metadata comes from the entry-point member (earliest `startedAt` where `initialPrompt NOT LIKE 'Agency "%'`). `status` is rolled up (running if any member running, else entry-point status). `startedAt` = min across members, `lastActivityAt` = max.

Include a fallback `INSERT OR IGNORE` for degenerate groups where all members have placeholder prompts (uses any member for metadata).

**C2.** Insert `agents` rows for all members: `sessionLocalId = agencyInstanceId`. `isEntryPoint = 1` for the entry-point member identified above.

**C3.** Consolidate `session_stats`: sum `totalTokens`, `totalCostUsd`, `turnCount` across all member rows into one row keyed by `agencyInstanceId`. Delete the old per-member stat rows.

**C4.** Re-key `drafts`: update `session_local_id` from the entry-point member's `localId` to `agencyInstanceId` for any draft belonging to an agency member.

**C5.** Delete all agency member `sessions` rows.

Note: `agency_handoffs.agency_instance_id` already equals the new session `localId` — no change needed.

### D. Drop removed columns from `sessions`

```sql
ALTER TABLE sessions DROP COLUMN sdk_session_id;
ALTER TABLE sessions DROP COLUMN role_id;
ALTER TABLE sessions DROP COLUMN role_name;
ALTER TABLE sessions DROP COLUMN role_instance_index;
ALTER TABLE sessions DROP COLUMN agency_instance_id;
```

SQLite 3.35+ required (Electron's bundled SQLite is 3.43+, so this is safe).

### Migration risks

- Agency group with no detectable entry point (all prompts are placeholders): handled by the `INSERT OR IGNORE` fallback in C1
- Solo session `localId` collision with any `agencyInstanceId`: practically impossible (both are UUIDs), but `INSERT OR IGNORE` guards against it
- Session stats for agency members with zero turns: `COALESCE(SUM(...), 0)` handles empty joins

---

## Phase 1 — DB Schema + Migration

**Files:**

- `apps/desktop/src/main/db/schema.ts` — add `agents` table definition; add `agentLocalId` to `sessionStats`; do NOT remove existing `sessions` columns yet (they are removed in the migration SQL, not in schema.ts ahead of time)
- `apps/desktop/src/main/db/migrations/0005_session_agent_split.sql` — full migration as above
- `apps/desktop/src/main/db/migrations/meta/_journal.json` — append entry for `0005_session_agent_split`

**Do not merge Phase 1 without Phase 2.** The app is broken between phases (backend still writes to removed columns). They ship together.

---

## Phase 2 — Main Process + IPC + Preload

Ships in the same release as Phase 1.

### `apps/desktop/src/shared/ipc-contract.ts`

**New `Agent` type** (mirrors agents table):

```typescript
export interface Agent {
  localId: string
  sessionLocalId: string
  sdkSessionId: string | null
  roleId: string | null
  roleName: string | null
  roleInstanceIndex: number | null
  initialPrompt: string
  isEntryPoint: boolean
  status: LiveSessionStatus
  startedAt: number
  lastActivityAt: number
}
```

**Updated `Session`:** remove `sdkSessionId`, `roleId`, `roleName`, `roleInstanceIndex`, `agencyInstanceId`. Add optional `agentCount?: number` (computed, not stored).

**Updated `LiveSessionStatusUpdate`:** add optional `agentLocalId?: string` (present = agent-level update; absent = session-level).

**Updated `LiveSessionStats.turnUsage`:** add `agentLocalId: string`.

**Updated `StartSessionParams`:** add `sessionLocalId?: string` (attach to existing session) and `agentLocalId?: string` (pre-supplied agent UUID). Remove `agencyInstanceId`, `roleInstanceIndex` (now internal to agent creation).

**New `AddAgentParams` type:**

```typescript
export interface AddAgentParams {
  roleName?: string
  roleId?: string
  initialPrompt: string
  model?: string
  effort?: RoleEffort
  permissionMode?: PermissionMode
  systemPromptAppend?: string
  allowedTools?: string[]
}
```

**New IPC channels:**

```typescript
sessions: {
  getAgents: (sessionLocalId: string) => Promise<Agent[]>
  addAgent:  (sessionLocalId: string, params: AddAgentParams) => Promise<string>
}
```

Add to `IPC_CHANNELS`: `sessionsGetAgents: 'sessions:getAgents'` and `sessionsAddAgent: 'sessions:addAgent'`.

**Updated `AgencyInstanceSession`:** add `sessionLocalId: string`. The `localId` field now refers to the agent UUID. The `AgencyInstance.instanceId` is the session UUID.

### `apps/desktop/src/main/session-registry.ts`

Major rewrite. New responsibilities:

- Read/write `sessions` rows (session-level only — no agent fields)
- Read/write `agents` rows (new)
- Compute session status roll-up from agent statuses

**New exports:**

```typescript
registerAgent(agent: Agent): void
updateAgent(localId: string, partial: Partial<Agent>): void
getAgent(localId: string): Agent | null
getAgentBySdkId(sdkSessionId: string): Agent | undefined
listAgentsBySession(sessionLocalId: string): Agent[]

function computeSessionStatus(agents: Agent[]): LiveSessionStatus {
  if (agents.some(a => a.status === 'running' || a.status === 'starting')) return 'running'
  if (agents.some(a => a.status === 'blocked')) return 'blocked'
  if (agents.every(a => a.status === 'completed')) return 'completed'
  if (agents.every(a => a.status === 'terminated')) return 'terminated'
  if (agents.some(a => a.status === 'error')) return 'error'
  return 'idle'
}
```

**Updated `rowToSession`:** no longer maps the removed columns.

**Updated `registerSession`:** no longer accepts agent-specific params.

**Updated `pruneExpired`:** `agency_handoffs` are now pruned by joining on `sessions.localId` (which equals what was `agencyInstanceId`):

```typescript
const expiredIds = db.select({ id: sessions.localId })
  .from(sessions).where(lt(sessions.lastActivityAt, cutoff)).all().map(r => r.id)
for (const id of expiredIds) {
  db.delete(agencyHandoffs).where(eq(agencyHandoffs.agencyInstanceId, id)).run()
}
db.delete(sessions).where(lt(sessions.lastActivityAt, cutoff)).run()
```

**`deleteAgency(instanceId)`:** deletes the single `sessions` row with `localId = instanceId`, cascades to all `agents` rows (ON DELETE CASCADE), deletes handoffs.

**SESSION_CAP:** after migration all sessions are top-level rows. The cap (currently 50, excluding agency sessions) now applies to all sessions. Raise cap to 100 or make it a user setting before Phase 2 ships.

### `apps/desktop/src/main/agent.ts`

**`ActiveSession` interface:** remove `agencyInstanceId`, `roleId`, `roleInstanceIndex`, `roleName`, `agencyName`, `agencyId`, `agencyScope`. Add `sessionLocalId: string` and `agentLocalId: string` (for solo sessions these are the same UUID).

**`startSession`:**

- If `params.sessionLocalId` is provided, the session row already exists — skip `registry.registerSession`. Only call `registry.registerAgent(...)`.
- If `params.sessionLocalId` is absent (solo session), create a session row AND an agent row. Use the same UUID for both (`agentLocalId = sessionLocalId`).
- Returns both `sessionLocalId` and `agentLocalId`.

**`consumeStream`:**

- On `system.init`: call `registry.updateAgent(session.agentLocalId, { sdkSessionId })` instead of updating the session.
- After stream completion: call `registry.updateAgent`, then `registry.listAgentsBySession`, then `computeSessionStatus`, then `registry.updateSession(session.sessionLocalId, { status: rollUp })`.
- `broadcastStatus` always carries `sessionId = session.sessionLocalId` for routing. Add `agentLocalId = session.agentLocalId`.

**`broadcastStats`:** keep `sessionId = session.sessionLocalId` for routing. Add `agentLocalId = session.agentLocalId`.

**`sendInput` / restart path:** look up `registry.getAgent(id)` for `sdkSessionId`; look up `registry.getSession(agent.sessionLocalId)` for project/model config.

### `apps/desktop/src/main/orchestrator.ts`

**`startAgency`:**

1. Generate `instanceId` (UUID) — this becomes the session `localId`.
2. Call `registry.registerSession({ localId: instanceId, projectPath, initialPrompt, agencyId, agencyScope, agencyName, ... })` — creates ONE session row.
3. For each role instance, call `startSession({ sessionLocalId: instanceId, agentLocalId: randomUUID(), roleId, roleName, roleInstanceIndex, initialPrompt: rolePrompt, ... })`.
4. `AgencyInstance` returned has `instanceId` = session UUID; each `AgencyInstanceSession.sessionLocalId = instanceId`.

**`spawnOverflow`:** call `startSession({ sessionLocalId: runtime.instanceId, agentLocalId: randomUUID(), ... })`. No new session row created.

**`injectAndWait` restart path:** `registry.getAgent(toSessionId)` to get `sdkSessionId`.

**`resumeAgency(instanceId)`:** `registry.getSession(instanceId)` for session metadata; `registry.listAgentsBySession(instanceId)` to get agents; build `roleSessionMap` from agents (replaces `listSessionsByAgency`).

**`RuntimeAgency`:** rename `agencyInstanceId` field to `sessionLocalId` throughout.

### `apps/desktop/src/main/ipc.ts`

**New handlers:**

```typescript
ipcMain.handle(IPC_CHANNELS.sessionsGetAgents, (_e, sessionLocalId: string) =>
  sessionRegistry.listAgentsBySession(sessionLocalId)
)

ipcMain.handle(IPC_CHANNELS.sessionsAddAgent, async (_e, sessionLocalId: string, params: AddAgentParams) => {
  const session = sessionRegistry.getSession(sessionLocalId)
  if (!session) throw new Error(`Session ${sessionLocalId} not found`)
  const agentLocalId = randomUUID()
  return startSession({
    localId: agentLocalId,
    sessionLocalId,
    projectPath: session.projectPath,
    worktreePath: session.worktreePath ?? undefined,
    ...params,
  })
})
```

**`sessions:deletePersisted`:** after deleting the session row, also delete agents and their stats (or rely on CASCADE).

### `apps/desktop/src/preload/index.ts`

Expose the two new channels on `window.agentkeeper.sessions`.

---

## Phase 3 — Renderer Store + Views

Ships independently after Phase 2.

### `apps/desktop/src/renderer/src/stores/sessions.ts`

**`LiveSession`:**

- Remove: `agencyInstanceId`, `roleName`, `roleId`, `agencyName` (gone from `Session` base type)
- Add: `agents: Agent[]` — populated on registration and on `sessions:getAgents` calls
- Add: `agentEvents: Record<string, TranscriptEvent[]>` — agentLocalId → events for that agent

**`visibleSessions` computed** (entire dedup block deleted):

```typescript
const visibleSessions = computed<LiveSession[]>(() =>
  Object.values(sessions)
    .filter(s => !s.isDraft)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
)
```

**`agentTokens: Reactive<Record<string, TokenStats>>`** — keyed by `agentLocalId`. `sessionTokens` remains session-level aggregate. Both are updated in `onStats` using `stats.turnUsage.agentLocalId` (agent) and `stats.turnUsage.sessionId` (session).

**`onEvent`:** route by `payload.sessionId` to find the session; write to `session.agentEvents[payload.agentLocalId]`.

**`onStatus`:**

- If `update.agentLocalId` present: find the agent in `session.agents`, update its `status`. Recompute and apply session roll-up status.
- If absent: session-level update (title, etc.) — apply directly to session.

**`registerExternal(entry)`:** now registers an agent within an existing session (the session row was registered when `agencies.start()` returned). Append to `sessions[entry.sessionLocalId].agents`.

**`promoteDraft` / agency path:** focus `instanceId` (the session UUID), not the entry-point agent's `localId`.

**`openPersisted`:** after restoring session, call `window.agentkeeper.sessions.getAgents(localId)` and populate `session.agents`.

**`openPersistedAgency`:** replaced by `openPersisted` — no special-casing needed.

**`subAgentCount(session)`:** returns `session.agents.length`.

**`dismiss`:** clears `agentEvents` and `agentTokens` entries for all agents in the session.

### `apps/desktop/src/renderer/src/views/SessionsList.vue`

- Delete `agencyGroups` computed and all `v-for="[instanceId, members] in agencyGroups"` template blocks
- Delete `openAgency`, `confirmDismissAgency`, `touchAgency`, `toggleAgency`, `selectedAgencies`
- **"Previous" section:** render all persisted sessions uniformly; show a `◎ N agents` badge when `session.agents.length > 1`; show `session.agencyName` as subtitle when set
- **Delete flow:** `confirmDismissSession` covers all cases — one `deletePersisted(localId)` call, cascade handles agents/handoffs/stats
- **Selection mode:** remove `selectedAgencies`; all selection is by session `localId`

### `apps/desktop/src/renderer/src/views/SessionsView.vue`

- Delete `agencyGroups` computed, `agencies: SessionCardData[]` list, `liveAgencyInstanceIds` exclusion
- **`allSessions` computed:** live sessions from `visibleSessions`; previous from `persistedSessions` filtered against live IDs; historical unchanged. No agency-source case.
- **`deleteSingleSession`:** `persisted` and `agency` cases collapse into one `deletePersisted` call
- **`handleCardClick`:** remove `agency` case

### `apps/desktop/src/renderer/src/components/session/SessionsSidebar.vue`

- `visibleSessions` already simplifies from the store change — no template changes required unless agency-specific rendering exists

### `apps/desktop/src/renderer/src/components/session/ContextPanel.vue`

- `agencyGroup` computed → `agents = computed(() => rootSession.value?.agents ?? [])`
- `isEntryPoint` reads `agent.isEntryPoint` bool (no prompt heuristic)
- `rowLabel`: `agent.isEntryPoint ? 'Main' : agent.roleName ?? 'Agent'`
- Token display: `store.agentTokens[agent.localId]` per agent; `store.sessionTokens[rootSessionId]` for total

### `apps/desktop/src/renderer/src/views/LiveSessionView.vue`

- `rootSession`: still `store.getSession(props.liveId)` — unchanged
- Selected agent: `selectedAgentLocalId` ref, defaulting to `rootSession.agents.find(a => a.isEntryPoint)?.localId`
- Events: read from `rootSession.agentEvents[selectedAgentLocalId]`
- Status badge / dot: reads `rootSession.status` (roll-up) — unchanged behaviour
- `onSend` / draft promotion: navigate to `/sessions/${instanceId}` (session UUID); entry-point agent is found via `agents.find(a => a.isEntryPoint)`

---

## Phasing & Merge Strategy

| Phase | Scope | Ships with | Risk |
|-------|-------|-----------|------|
| 1 | DB schema + migration | Phase 2 (same PR or back-to-back) | Medium — data migration |
| 2 | Main process, IPC, preload | Phase 1 | High — many files, behavioural change |
| 3 | Renderer store + all views | Independently after Phase 2 | Low — UI cleanup |

Phase 2 is backward-compatible with the old renderer: `agencyInstanceId` is gone from the `Session` type, so the dedup guard `if (s.agencyInstanceId)` in `visibleSessions` never triggers (field is undefined). Agency grouping in the views produces empty results harmlessly. The sessions list correctly shows all sessions without dedup as soon as Phase 2 ships, even before Phase 3 cleans up the dead code.

## Open Decision

**`SESSION_CAP`** is currently 50 and excluded agency sessions via `isNull(sessions.agencyInstanceId)`. After migration all sessions are top-level rows and agency sessions count against the cap. Decide before Phase 2 ships: raise to 100 or add a user setting.
