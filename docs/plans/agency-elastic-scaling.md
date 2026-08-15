# Agency Elastic Scaling (min/max)

Status: not started. Branch: `feat/agency-elastic-scaling` off `main` (`f41b7ee`).
Investigated: 2026-08-14
Prerequisite shipped: PR #47 (per-instance restart params, routing log).

Intended behaviour, in the user's words: a role declares a floor and a ceiling
and the orchestrator "spins up additional instances as needed and spins them
down after they complete their tasks" — pods scaling under pressure.

Everything below is from reading `apps/desktop/src/main/orchestrator.ts` at
`f41b7ee`. Defects marked **[unverified]** are derived from the code but have
not been reproduced live; confirm each with the routing log before fixing it.
The previous round of work on this file produced two confidently-wrong
diagnoses from static reading alone, so the log is the arbiter, not the code.

## Current state

Scale-up works. Scale-down does not exist, and the code that looks like
scale-down leaves the role permanently pinned at its ceiling.

| config | initial spawn | can grow? |
|---|---|---|
| `count: N` | N | no — `max` is undefined, so `reserveOverflowSlot` returns null at :218 |
| `min: N`, `max: M` | N (:1083) | yes, to M |
| neither | 1 (:1085) | no |

`count` takes precedence over `min` (:1081), so a slot carrying both silently
ignores `min`.

Scale-up path, all synchronous through the claim (fixed in #47):
`routeMessage` → no idle instance → `reserveOverflowSlot` (:216) checks
`existing.length >= slot.max` and pushes the new instance → `launchOverflow`
starts the session.

Teardown path: `deliverToInstance`'s `finally` (:406) sends overflow instances
to `requestHandoffAndSuspend` (:327), which collects a handoff summary, records
it in `handoffsByRole`, and calls `interruptSession`.

## Defects

### 1. Suspended instances are never removed from the pool

`requestHandoffAndSuspend` (:327-385) interrupts the session but never splices
the instance out of `runtime.instancesByRole`. The only splice in the file
(:313) is `launchOverflow`'s rollback on spawn failure.

Consequences:

- `reserveOverflowSlot`'s ceiling check (:218) counts suspended instances, so
  once a role touches `max` it can never spawn again for the life of the
  agency. Second wave of pressure queues instead of scaling.
- `idleInstance` (:145) only filters on `busySessions`, so a *suspended*
  instance reads as idle and will be selected for new work. It is then revived
  by `injectAndWait`'s resume path (:427) — which is why this never surfaced as
  a lost message. Effectively the system is scale-up-then-reuse, not
  scale-down.

The revival is arguably desirable; the permanent ceiling is not. Both stem from
one missing concept: pool membership is currently implicit.

### 2. Instance is marked idle before the handoff completes **[unverified]**

`deliverToInstance` (:404-408) deletes from `busySessions` and *then* awaits
`requestHandoffAndSuspend`. During the handoff turn — which is a full model
round-trip (:338-341) — the instance reads as idle and can be handed a fresh
message. Two conversations then interleave on one session, the failure mode
`busySessions` exists to prevent (cf. the direct-addressing guard at :540).

Widens with fan-out: five instances finishing at staggered times means five
handoff windows.

### 3. Queued work stalls behind overflow completion **[unverified]**

`drainPendingForRole` is called only on the non-overflow branch (:409). When an
overflow instance finishes and suspends, the role's pending queue is not
drained — even though that instance just became available. Queued messages wait
for a *base* instance to finish instead, or time out after
`SEND_MESSAGE_TIMEOUT_MS` (15 min) with a NOT-delivered error.

### 4. Instance indices are positional, not stable

`reserveOverflowSlot` computes `nextIndex = existing.length + 1` (:220). Correct
only while the array never shrinks. Fixing defect 1 by splicing would make
indices collide: remove `developer-3`, spawn again, and the new instance is also
`developer-3` — while `handoffsByRole` (:378) still holds the *old* one's
summary under `instanceIndex: 3`, and any peer holding the id addresses the
wrong agent.

Any fix to defect 1 must land with a monotonic per-role counter, not after it.

### 5. `min` is only a starting count

Nothing reads `slot.min` after the initial spawn (:1083 is the sole use). There
is no floor enforcement — if a base instance dies under `onFailure: 'continue'`
the role silently runs below `min` forever.

### 6. Preamble advertises the ceiling as the population

`totalInstances: slot.max ?? nextIndex` (:268) and :1112, so every agent is told
"instance 3 of 5" even when two instances exist. Harmless to routing, but the
preamble also lists `Current agency members` (:692 in the previous revision),
which goes stale the moment anything scales.

## Plan

Each phase is its own branch off `main`, in order — 1 and 2 are prerequisites
for the rest.

### Phase 1 — explicit instance lifecycle + stable indices

Branch: `feat/agency-instance-lifecycle`

Replace `isOverflow: boolean` (:50) with an explicit state, and add a monotonic
counter so ids are never reused:

```ts
type InstanceState = 'active' | 'suspending' | 'suspended'

interface AgentInstance {
  localId: string
  roleId: string
  instanceIndex: number
  instanceId: string
  /** Above the role's floor — eligible for reclaim. */
  elastic: boolean
  state: InstanceState
}

interface RuntimeAgency {
  /** roleId → highest index ever issued. Never decremented. */
  nextIndexByRole: Map<string, number>
}
```

- `idleInstance` selects only `state === 'active'` and not in `busySessions`.
- `reserveOverflowSlot`'s ceiling counts only non-`suspended` instances, which
  releases the ceiling without splicing the array — suspended entries stay for
  their handoff history and for revival by id.
- `instanceIndex` comes from `nextIndexByRole`, not `existing.length`.

Addresses defects 1 and 4. Keeps `injectAndWait`'s revival path working: a
message addressed to a suspended instance still resumes it, and should flip it
back to `active`.

### Phase 2 — close the handoff window

Branch: `fix/agency-handoff-window`

In `deliverToInstance` (:404), set `state = 'suspending'` *before* releasing
`busySessions`, and only release after `requestHandoffAndSuspend` resolves.
With phase 1's `idleInstance` filter, a suspending instance is unselectable
regardless of its busy flag.

Addresses defect 2. Verify with a fan-out where tasks finish at staggered times
(vary the sleep per probe) — the log should never route to an instance whose
handoff is in flight.

### Phase 3 — drain on every release

Branch: `fix/agency-queue-drain`

Call `drainPendingForRole` on both branches of :406, after the handoff settles.
Then reconsider the drain itself: it currently shifts one entry and routes it to
an idle instance (:387-394), but under `min`/`max` a queued entry should be
able to *trigger a spawn* rather than wait. Make the drain reuse the same
resolution path as `routeMessage` — idle → reserve → queue — rather than
duplicating a narrower version of it.

Addresses defect 3.

### Phase 4 — reclaim policy

Branch: `feat/agency-reclaim-policy`

Only now is "spin down" meaningful. Decide and document:

- **Which instances are reclaimable** — `elastic === true`, i.e. index above
  `min`. Base instances never suspend.
- **When** — immediately on task completion (current behaviour, cheapest,
  thrashes under bursty load) versus after an idle grace period (needs a timer
  per instance and a cancel path). Recommend starting with immediate, since the
  handoff summary already makes suspension non-lossy, and adding a grace period
  only if the log shows spawn/suspend churn within a single fan-out.
- **Floor enforcement** — on any transition, if active instances for a role fall
  below `min`, spawn back up to `min`. Covers defect 5 and agent death.

### Phase 5 — preamble accuracy and observability

Branch: `feat/agency-scaling-observability`

- `totalInstances` should describe the live population, with the ceiling stated
  separately if it is useful to the agent at all (defect 6).
- Extend the routing log with lifecycle transitions — spawn, suspend, revive,
  floor-restore — so scaling is legible in the same stream as routing.
- Re-examine `Current agency members` in the preamble: under elastic scaling it
  is stale by construction. Either drop it or regenerate it on revival.

## Test protocol

Config under test — note `count` must be **removed**, not merely supplemented,
or it wins at :1081:

```yaml
  - id: developer
    min: 2
    max: 5
```

Pressure prompt: five genuinely independent work items, with no mention of
instances, parallelism, or `send_messages`. The agency preamble already
instructs peers to batch independent sub-tasks, so the decomposition should be
the model's own choice — that is the path worth testing.

Expected log on a healthy run:

```
send_messages batch of 5
route ... -> developer-1 (idle)               | pool: dev-1:idle dev-2:idle
route ... -> developer-2 (idle)               | pool: dev-1:busy dev-2:idle
route ... -> developer-3 (overflow, spawning) | pool: dev-1:busy dev-2:busy
route ... -> developer-4 (overflow, spawning) | ...
route ... -> developer-5 (overflow, spawning) | ...
```

All five claims resolve synchronously before any task completes, so spawn
pressure lands regardless of task duration.

The decisive second test, which the current code fails: run the same prompt
**twice** in one agency session. Wave 2 should scale up again. Today it queues,
because the ceiling never releases (defect 1).

Cross-check instance identity against the persisted transcripts rather than the
planner's report — the planner's attribution has been wrong twice:

```sh
sqlite3 ~/Library/Application\ Support/AgentKeeper/agentkeeper.db \
  "select role_instance_index, sdk_session_id from agents
   where role_id='developer' order by started_at desc limit 5;"
# then read ~/.claude/projects/*/<sdk_session_id>.jsonl
```
