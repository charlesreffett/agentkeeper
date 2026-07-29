# Agency Tool Enforcement & Session Hangs

Status: Phases 1–5 shipped (PRs #21–#25), Phase 6 in this branch.
Deferred: blocked-status refcount (see end of doc).
Investigated: 2026-07-18

Each phase gets its own branch off `main`. Branch names listed per phase.

## Context

Reported symptom: agents delegate to background agents, the spawning agent
goes idle, and the response never arrives. Separately, agency agents are
sometimes observed stuck in `running` forever, never reaching `idle`.

Investigation confirmed subagents *are* being spawned — the planner
transcript (`~/.claude/projects/-Volumes-workspace-agentkeeper/9271c80e-…jsonl`)
shows a successful foreground `Agent` call with `subagent_type:
caveman:cavecrew-investigator`, whose result returned normally. Foreground
delegation works. The failures come from three unrelated defects that all
present similarly.

### The central discovery

`allowedTools` has never restricted anything. From the SDK types
(`@anthropic-ai/claude-agent-sdk@0.3.214`, `sdk.d.ts:1342-1348`):

> `allowedTools`: List of tool names that are auto-allowed **without prompting
> for permission**. … To restrict which tools are available, use the `tools`
> option instead.

It is a permission-prompt bypass list. Combined with
`permissionMode: 'bypassPermissions'` (`harness/claude-code.ts:33`), it is a
complete no-op. Every `allowedTools` block in every role `.md` file does
nothing — which is why the planner invoked `Agent` while not declaring it.

The real levers:

| option | line | effect |
|---|---|---|
| `disallowedTools` | `sdk.d.ts:1368` | removed from model context, cannot be used |
| `tools` | `sdk.d.ts:1395` | base built-in set; `[]` disables all built-ins |
| `agents` | `sdk.d.ts:1340` | defines which subagents `Agent` may invoke |

MCP tools are injected automatically via `mcpServers: { agentkeeper: … }`
(`agent.ts:604-627`). The model sees `mcp__agentkeeper__send_message` with no
role config at all. `withOrchestraMcp` appending it to `allowedTools`
(`orchestrator.ts:83-86`) is dead code under bypass mode. Roles should not
declare MCP tools.

### The design split

Background subagents are legitimate for a **solo session** — the agent should
use whatever the harness offers. Agents inside an **agency** should never
spawn their own subagents; coordination is `send_message`. Both halves need
accounting for:

| | solo session | agency agent |
|---|---|---|
| `Agent` tool | allowed | denied via `disallowedTools` |
| background tasks | allowed — needs notification fix | moot once `Agent` denied |
| coordination | subagents | `send_message` only |

Denying `Agent` in agencies scopes the background problem but does not remove
it. Solo sessions still need `consumeStream` to stop tearing down while
background work is outstanding.

### Three causes of "stuck in running / never idles"

1. **`blocked`/`running` is a non-refcounted flag.** The preamble
   (`orchestrator.ts:642-644`) instructs agents to fire multiple
   `send_message` calls in one turn. Each concurrent `routeMessage` does
   `setAgentStatus(from, 'blocked')` … `finally { setAgentStatus(from,
   'running') }`. The first send to return flips the caller to `running`
   while it is still blocked on the others. Traced in code, **not yet
   reproduced against a live stuck agent.**
2. **Instance-id routing bypass.** `orchestrator.ts:508` calls
   `injectAndWait` directly, skipping `deliverToInstance` (`:363-379`), so the
   target never enters `busySessions` and `drainPendingForRole` (`:354`) never
   fires. Anything in `pendingByRole` waits forever. No timeout on the path.
3. **Background subagent deadlock.** Agent spawns a background `Agent`, ends
   its turn, `consumeStream` (`agent.ts:334-344`) closes the input queue and
   `finally` (`:419-421`) evicts the session from `active`. The completion
   notification has no live stream to land in, and nothing listens for one.
   `grep -c background agent.ts harness/*.ts` → 0.

### Decision: drop the allowlist, keep a targeted deny list

Original intent of role `allowedTools` was to scope an agent's authority. In
practice an allowlist forces every role to enumerate everything it needs,
which is a hindrance more than a guardrail — and the user already runs in
bypass mode, so the permission-prompt behavior `allowedTools` actually
controls is irrelevant.

Resolution: **drop `allowedTools` as an authoring surface.** Roles get the
full default toolset. Keep a small `disallowedTools` deny list for the few
places a hard boundary is genuinely wanted.

The mechanism cannot be dropped entirely — denying `Agent` inside agencies
depends on it.

Deny entries to implement:

| scope | denied |
|---|---|
| any agency agent | `Agent` |

Decided: **no `Edit`/`Write` deny for `planner` or `reviewer`.** `CLAUDE.md`
claims "Don't edit from the `planner` role — it's tool-restricted for a
reason," and the reviewer prompt says "you do not edit." Neither has ever been
enforced (the allowlist is a no-op). The original constraint dates to early
project churn and is no longer a concern, so those roles stay prompt-only and
the stale `CLAUDE.md` claim gets removed in Phase 6.

The `disallowedTools` mechanism is still built and must work correctly — the
agency `Agent` deny depends on it, and it is the hook for any future
restriction.

---

## Phase 1 — Background-completion handling (solo sessions)

Branch: `fix/background-completion`

Promoted to first: this is the only fix for the originally reported symptom,
it affects solo sessions that are in daily use, and background completion can
corrupt unrelated tasks. Independent of every other phase.

### Protocol (investigated — SDK 0.3.214)

The SDK **pushes** completion; no host polling is required. Everything below
is verified against `sdk.d.ts` and the native CLI bundle.

- `SDKTaskNotificationMessage` (`sdk.d.ts:4396`) — `type:'system'`,
  `subtype:'task_notification'`, `status: 'completed'|'failed'|'stopped'`,
  plus `task_id`, `tool_use_id?`, `output_file`, `summary`. Exactly one per
  `task_id` per process (dedupe is a `Set.add` in the CLI). Arrives on the
  same async iterable as every other message.
- `SDKBackgroundTasksChangedMessage` (`sdk.d.ts:2880`) — `type:'system'`,
  `subtype:'background_tasks_changed'`, `tasks: {task_id, task_type,
  description}[]`. **REPLACE semantics**, emitted on every membership change.
  This is the level signal to track outstanding work. Caveats from its own
  doc: nothing emitted at startup (assume empty on (re)start), ordering vs
  `task_started`/`task_notification` is unspecified, per-process only.
- Bookends: `SDKTaskStartedMessage` (`:4436`), `SDKTaskProgressMessage`
  (`:4413`), `SDKTaskUpdatedMessage` (`:4459`).
- The CLI resumes the turn itself by injecting a **synthetic user message** —
  an XML `task-notification` frame — which surfaces to the host as a normal
  `type:'user'` `SDKMessage` with `origin.kind === 'task-notification'`
  (`sdk.d.ts:3999`, `:4531`), followed by a fresh assistant turn and a second
  `result`. AgentKeeper does not have to synthesize anything.

Explicitly absent (confirmed, not inferred):
- No field on `result` indicating outstanding background work. Only
  `terminal_reason?` (`sdk.d.ts:6821`), whose union includes
  `'background_requested'` — that says why *this* turn ended, not what
  remains.
- No `Query` method to list or await tasks. The only two background members
  are `stopTask(taskId)` (`:2534`) and `backgroundTasks(toolUseId?)`
  (`:2548`, the Ctrl+B equivalent).
- No initial task snapshot at session start; no CLI→host control_request for
  completion.

### Why AgentKeeper loses it

The CLI winds down once **stdin closes**. `sdk.mjs` closes stdin itself only
for single-turn queries (`if (this.isSingleUserTurn) … endInput()`), but
AgentKeeper passes a streaming input iterable (`options.messageQueue`,
`harness/claude-code.ts:56`), so it is *not* single-turn — the drain loop
stays alive as long as the input stream stays open.

`agent.ts:343` closes it on the first `result`:

```ts
setStatus(session, … ? 'idle' : 'suspended')
try { session.input.close() } catch {}
break
```

With input closed and nothing pending, the CLI kills background **shells**
after a 5 s grace (`mei=5000`) and keeps **agents/workflows** alive only up to
a 600 s ceiling (`ovS=600000`, overridable via
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). On restart, orphaned tasks are
reconciled with a synthetic `stopped` notification — which is precisely the
"No completion record was found … from the previous session" message.

### Implementation

1. Track outstanding tasks per session from `background_tasks_changed`
   (REPLACE, not merge). Treat absent-at-startup as empty.
2. In `consumeStream`, on `result`: if outstanding tasks is non-empty, do
   **not** close the input queue and do **not** `break` — keep consuming.
   The existing `finally` (`:419-421`) then never evicts the session.
3. The CLI injects the completion turn on its own; the loop sees a `user`
   message with `origin.kind === 'task-notification'`, a new assistant turn,
   and a second `result`. Close on that one if nothing is outstanding.
4. Status while parked: the agency discriminator at `:342` still needs to
   signal `idle` so `waitForNextIdle` resolves for `routeMessage`, but the
   session must stay in `active`. Confirm these two do not conflict.
5. Add a host-side cap so a task that never completes cannot leak a session
   forever. Mirror the SDK's 600 s ceiling rather than waiting unbounded.

Open question: `background_tasks_changed` ordering vs the bookends is
unspecified, so a naive "close when the set empties" check may race a
task that is about to start. Consider a short debounce, or gate on
`terminal_reason === 'background_requested'` as a corroborating signal.

Verify: solo session spawns a background `Agent`, ends its turn, completion
arrives and the agent resumes on its own.

## Phase 2 — Drop `allowedTools`, add targeted deny list

Branch: `fix/role-tool-enforcement`

- Harness: replace `allowedTools` plumbing with `disallowedTools` in
  `harness/claude-code.ts:46-48`.
- Thread the new shape through `agent.ts:626`,
  `orchestrator.ts:258/412/873/1012/1054/1247/1266`, `mobile-server.ts:215`.
- `roles.ts:72-87` and `:211-219` — stop parsing `allowedTools`; decide
  whether to strip the now-dead field from existing role `.md` files or leave
  it as inert frontmatter (leaving it is confusing; recommend stripping).
- Remove MCP tool names from role frontmatter — injected automatically via
  `mcpServers`. Delete `withOrchestraMcp`'s `allowedTools` append
  (`orchestrator.ts:83-86`) once dead.
- Update the role-generation prompt at `roles.ts:189` to stop offering a tool
  menu.
- Delete the phantom `mcp__agentkeeper__send_messages` (plural) from
  `~/.agentkeeper/roles/developer.md` and `~/.agentkeeper/roles/planner.md`.
  No such tool exists anywhere in the repo.
Verify: start an agency agent and confirm the `Agent` tool is absent from its
context and cannot be called.

## Phase 3 — Deny `Agent` for agency agents

Branch: `fix/agency-no-subagents`

Small once Phase 2 works. Add `Agent` to the deny set for any session where
`sessionLocalId !== agentLocalId` (the existing agency discriminator at
`agent.ts:342`). Leave solo sessions untouched.

Verify: agency planner asked to delegate reaches for `send_message`, not
`Agent`.

## Phase 4 — Fix instance-id routing

Branch: `fix/instance-id-routing`

Route `orchestrator.ts:508` through `deliverToInstance` so `busySessions` and
`drainPendingForRole` stay correct. Watch for the double-injection case where
`idleInstance` (`:129`) currently reports a mid-turn agent as idle.

Verify: two peers addressed by instance id concurrently; confirm both enter
`busySessions` and the pending queue drains.

## Phase 5 — Timeout on `injectAndWait`

Branch: `fix/send-message-timeout`

Backstop. `injectAndWait` (`orchestrator.ts:381-464`) awaits
`waitForNextIdle` with no timeout. Add one that rejects with a useful message
so a future bug degrades to an error string instead of a permanent hang.
Also reject queued `pendingByRole` entries on timeout.

## Phase 6 — Audit and clean up `CLAUDE.md`

Branch: `docs/claude-md-audit`

Runs last, once the code is settled and the file can be checked against
reality rather than intent.

Known-stale items found during this investigation:

- "Don't edit from the `planner` role — it's tool-restricted for a reason."
  Never enforced; constraint dropped by decision above. Remove.
- Role frontmatter documentation, if it references `allowedTools` — the field
  is gone as of Phase 2.
- Agency workflow section — verify the `send_message` description still
  matches behavior after Phases 3-5 (blocking semantics, cycle rejection,
  new timeout).
- Gotchas section — the `permissionMode: 'bypassPermissions'` note should
  gain the finding that `allowedTools` is a permission-prompt bypass list and
  therefore inert under bypass mode. This is the non-obvious fact that caused
  the whole investigation.

Beyond that, audit the whole file: slice status (V0-V6) against what actually
shipped, stale "⬜ deferred" items that have since landed, commands that no
longer exist, and layout claims against the current tree.

Branch: `fix/blocked-status-refcount` (when picked up)

**Deferred until Phases 1-5 are confirmed working.** Replace the boolean
`setAgentStatus` flip with a per-session pending-send counter: increment on
entering `routeMessage`, decrement in `finally`, only return to `running`
at zero.

Deferred deliberately: cause 1 is traced but unreproduced, and fixing the
other phases may change or eliminate the observed behavior. Revisit with
status-transition logging once the rest is stable.

---

## Sequencing

Phase 1 → 2 → 3 → 4 → 5 → 6, then reassess the deferred item.

- Phase 1 is independent of everything else and fixes the reported symptom.
- Phase 3 depends on Phase 2 (needs the deny mechanism).
- Phases 4 and 5 are independent of 1-3 and could run in parallel.
- Phase 6 runs last by design — auditing docs against unfinished code just
  produces a second round of stale claims.

## Files touched (summary)

- `apps/desktop/src/main/harness/claude-code.ts` — tool option conversion
- `apps/desktop/src/main/agent.ts` — tool threading, agency discriminator,
  background-aware stream teardown
- `apps/desktop/src/main/orchestrator.ts` — instance-id routing, timeout,
  dead `withOrchestraMcp` append
- `apps/desktop/src/main/roles.ts` — frontmatter schema, generator prompt
- `apps/desktop/src/main/mobile-server.ts` — tool threading
- `packages/sdk/src/index.ts` — `allowedTools` removed from the role contract
- `~/.agentkeeper/roles/{developer,planner}.md` — phantom tool cleanup
- `.agentkeeper/roles/*.md` + `~/.agentkeeper/roles/*.md` — strip dead
  `allowedTools` frontmatter
- `CLAUDE.md` — Phase 6 audit
