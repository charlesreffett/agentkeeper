# Agency Elastic Scaling (min/max)

Status: not started. Branch: `feat/agency-elastic-scaling` off `main` (`f41b7ee`).
Investigated: 2026-08-14
Prerequisite shipped: PR #47 (per-instance restart params, routing log).

Design: **grow-and-flush**. A role keeps `min` warm instances, grows to `max`
under pressure, and reclaims elastic instances on task completion. Before
suspending, an instance flushes its reasoning into durable artifacts — code
comments, commit bodies, plan docs — rather than into orchestrator memory.
Context is externalized, not preserved.

Everything below is from reading `apps/desktop/src/main/orchestrator.ts` at
`f41b7ee`. The previous round of work on this file produced two
confidently-wrong diagnoses from static reading alone, so defects were
confirmed against a live run rather than accepted from the code.

## Live verification, 2026-08-14

Driven headlessly per the `live-verify-driver` pattern: built app launched via
Playwright `_electron` with an isolated `--user-data-dir` seeded from a copy of
the real DB, against a `min: 2, max: 5` agency, with a seven-item independent
work prompt. Temporary lifecycle instrumentation logged each transition.

Observed fan-out — scale-up works exactly as designed:

```
send_messages batch of 7
route -> developer-1 (idle)               | pool: dev-1:idle dev-2:idle
route -> developer-2 (idle)               | pool: dev-1:busy dev-2:idle
reserve(developer) granted — pool 2 -> 3, max=5
route -> developer-3 (overflow, spawning)
reserve(developer) granted — pool 3 -> 4, max=5
route -> developer-4 (overflow, spawning)
reserve(developer) granted — pool 4 -> 5, max=5
route -> developer-5 (overflow, spawning)
reserve(developer) REFUSED — pool=5 max=5
route -> queued (depth 1)
reserve(developer) REFUSED — pool=5 max=5
route -> queued (depth 2)
```

**Caveat, stated up front:** the test agents hit an account session limit
(`You've hit your session limit`) and returned errors instead of performing the
audits, so every task completed in ~4s. The three findings below are all
*ordering* properties of `deliverToInstance`'s `finally` block, independent of
what the task did — but the run did not exercise realistic task durations, and
the second-wave ceiling test was not performed. Re-run for that.

## Why elastic at all

Worth stating, because the case is narrower than the pod analogy suggests.

An idle agent costs almost nothing here — no tokens flow while it waits. A warm
idle instance costs one spawn turn, a `claude` subprocess in RAM, and a tile in
the monitor grid. So `min: 3, max: 6` versus a flat `count: 6` differs by three
subprocesses and three short spawn turns. That is not the justification.

The real benefit is **behavioural**. The preamble tells each agent
`Current agency members: …`. With a flat count of 6 the planner sees six
developers, and models tend to fill available parallelism — you get six-way
splits of work that wanted three. With `min: 3` the visible pool is three, so
the typical run stays narrow and only widens under genuine pressure. Elastic
makes `max` a **safety ceiling rather than a target**.

Secondary: when burst width is unknown, a flat count forces pre-committing to
the worst case — wasteful when you needed two, still queueing when you needed
nine.

## Why reclaim is safe: externalize, don't preserve

The obvious objection to reclaim is that an instance holds reasoning no other
agent has — what it tried, what it rejected, why. Three options were considered:

1. **Resume the original session.** Lossless: `interruptSession` (:384) stops the
   process but `sdkSessionId` persists, and `injectAndWait` (:427-440) resumes
   via `resumeSdkSessionId`, restoring the full transcript.
2. **Inject a handoff summary** into a fresh instance. What the code does today.
3. **Nothing** — a fresh agent reads the code and forms its own view.

**Chosen: 3, with a flush step.** Reasons, in order of weight:

- **Stale context is worse than none.** A revived agent's model of the tree may
  be hours out of date — other agents have edited those files since. It will act
  confidently on a world that no longer exists. A fresh agent reading current
  `HEAD` is simply correct.
- **A transcript is a bad medium for durable reasoning.** It is invisible,
  unversioned, unreviewable, and reachable only by whoever holds the right
  instance id. Code comments, commit bodies, and plan docs are versioned,
  reviewable, and readable by any agent — including a human.
- **Resume is unbounded in cost.** It re-sends the whole transcript, and gets
  more expensive the longer the session ran. Re-reading is bounded by the size
  of the relevant code, and parallelizes.
- **Relevance inference is intractable.** Option 2 requires deciding *when* old
  context matters to new work. Option 1 avoids that by making the caller name
  the instance, but then needs reply attribution, per-instance queueing, and a
  durable work-thread identity separate from the pool slot — a large subsystem
  whose payoff is reclaiming near-free resources.

So the rule is:

> Reclaim is safe exactly when the agent has externalized its reasoning.

This also repairs the pod analogy. Agents look stateful and therefore unlike
pods — but statelessness is *achieved*, not inherent. Pods scale cleanly because
their state lives in a database. Flush-on-reclaim is the same move: put the
state in the repo and the instance becomes genuinely interchangeable.

**Retain transcripts anyway**, for human forensics — reading persisted
transcripts is how the identity bug behind #47 was found. Retained for
debugging, not wired into routing.

## Current state

Scale-up works. Reclaim does not exist, and the code that resembles it leaves
the role permanently pinned at its ceiling.

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
to `requestHandoffAndSuspend` (:327), which collects a summary, records it in
`handoffsByRole`, and calls `interruptSession`.

## Defects

### 1. Suspended instances are never removed from the pool

`requestHandoffAndSuspend` (:327-385) interrupts the session but never splices
the instance out of `runtime.instancesByRole`. The only splice in the file
(:313) is `launchOverflow`'s rollback on spawn failure.

Live run — all three elastic instances remained pool members after suspending:

```
03:15:15.260  developer-3 handoff END (suspended, still in pool: true)
03:15:16.447  developer-5 handoff END (suspended, still in pool: true)
03:15:17.205  developer-4 handoff END (suspended, still in pool: true)
```

**Observed:** suspended instances stay in `instancesByRole`. **Inferred, not yet
observed:** that this blocks a second wave. The `reserve REFUSED` lines in that
run fired while all five instances were genuinely busy, not suspended — so they
are not evidence for the ceiling defect. Confirming it needs a second fan-out
*after* suspension completes; the session limit cut the run short before that.

Consequences:

- `reserveOverflowSlot`'s ceiling check (:218) counts suspended instances, so
  once a role touches `max` it can never spawn again for the life of the
  agency. A second wave of pressure queues instead of scaling.
- `idleInstance` (:145) filters only on `busySessions`, so a *suspended*
  instance reads as idle and gets selected for new work. It is then silently
  revived by `injectAndWait`'s resume path (:427) — which is why this never
  surfaced as a lost message, and which under grow-and-flush is exactly the
  stale-context revival we do not want.

### 2. Instance is marked idle before the flush completes **[CONFIRMED]**

`deliverToInstance` (:404-408) deletes from `busySessions` and *then* awaits
`requestHandoffAndSuspend`. During that turn — a full model round-trip
(:338-341) — the instance reads as idle and can be handed a fresh message. Two
conversations then interleave on one session, the failure mode `busySessions`
exists to prevent (cf. the direct-addressing guard at :540).

Live run — a 945ms window in which developer-3 was both suspending *and* the
first instance `idleInstance` would return, with two entries sitting in the
queue:

```
03:15:14.315  developer-3 task done -> busySessions RELEASED (overflow=true), queue depth=2
03:15:14.315  developer-3 handoff START — instance now reads as: SELECTABLE/IDLE
03:15:14.429  drain(developer) delivering queued entry to developer-1   <- 114ms INTO the window
03:15:15.260  developer-3 handoff END
```

The drain at `.429` ran *inside* developer-3's handoff and called
`idleInstance`. It happened to pick developer-1, which had been released 114ms
earlier and sorts first in the pool array — pure ordering luck. Had developer-1
still been busy, that queued entry would have been injected into a session
mid-handoff.

Worse in practice than in this run: the handoff turn here was ~1s because the
agent erred out immediately. A real flush is a full model turn, widening the
window proportionally. Also widens with fan-out — five staggered completions
mean five windows.

### 3. Queued work stalls behind reclaim **[CONFIRMED]**

`drainPendingForRole` is called only on the non-overflow branch (:409). When an
elastic instance finishes and suspends, the role's pending queue is not drained
— even though capacity just freed up. Queued messages wait for a base instance
to finish, or time out after `SEND_MESSAGE_TIMEOUT_MS` (15 min) with a
NOT-delivered error.

Live run — all three elastic completions skipped the drain while the queue was
non-empty; only the two base instances drained it:

```
03:15:14.315  developer-3 done (overflow=true),  queue depth=2 — drain NOT called
03:15:14.429  developer-1 done (overflow=false), queue depth=2 — drain -> developer-1, 2->1
03:15:15.219  developer-2 done (overflow=false), queue depth=1 — drain -> developer-2, 1->0
03:15:15.522  developer-5 done (overflow=true),  queue depth=0 — drain NOT called
03:15:16.260  developer-4 done (overflow=true),  queue depth=0 — drain NOT called
```

The queue drained here only because base instances happened to finish while
work was still queued. Had the two queued entries been waiting solely on
elastic completions, they would have sat until the 15-minute timeout.

### 4. Instance indices are positional, not stable

`reserveOverflowSlot` computes `nextIndex = existing.length + 1` (:220). Correct
only while the array never shrinks. Reclaiming instances makes indices collide:
free `developer-3`, spawn again, and the new instance is also `developer-3` —
while any peer holding the id addresses the wrong agent.

Must land *with* the reclaim fix, not after it.

### 5. `min` is only a starting count

Nothing reads `slot.min` after the initial spawn (:1083 is the sole use). No
floor enforcement — if a base instance dies under `onFailure: 'continue'`, the
role silently runs below `min` forever.

### 6. Handoff summaries are unbounded and broadcast

`handoffsByRole` accumulates for the life of the agency, and every summary is
injected into every subsequently spawned instance of that role (:250-257). After
N reclaims each cold spawn carries N summaries of work it will never touch.
Under grow-and-flush this subsystem is deleted rather than fixed.

### 7. Preamble advertises the ceiling as the population

`totalInstances: slot.max ?? nextIndex` (:268) and :1112, so every agent is told
"instance 3 of 5" even when two instances exist. The preamble also lists
`Current agency members`, which goes stale the moment anything scales — and
which is the mechanism the whole elastic design leans on (see "Why elastic at
all").

## Plan

Three phases, each its own branch off `main`. Phase 1 is a hard prerequisite
for 2 and 3.

### Phase 1 — lifecycle, stable indices, flush-on-reclaim

Branch: `feat/agency-instance-lifecycle`

The core of the design. Addresses defects 1, 2, 4, and 6.

Replace `isOverflow: boolean` (:50) with explicit state, and add a monotonic
counter so ids are never reused:

```ts
type InstanceState = 'active' | 'flushing' | 'retired'

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

- `idleInstance` selects only `state === 'active'`. A retired instance is never
  routed to, which also closes the accidental-revival path in defect 1.
- `reserveOverflowSlot`'s ceiling counts only non-`retired` instances, releasing
  the ceiling without splicing the array.
- `instanceIndex` comes from `nextIndexByRole`, not `existing.length`.
- `deliverToInstance` sets `flushing` **before** releasing `busySessions`, and
  releases only after the flush resolves (defect 2).

Rewrite `requestHandoffAndSuspend` as `flushAndRetire`. Same position in the
lifecycle, same one model turn, but the output goes to the repo instead of to
orchestrator memory:

> Before suspending: make sure anything a future developer needs is in the
> artifacts, not in your head. Non-obvious decisions and rejected alternatives
> belong in code comments or the commit body. Reply DONE when the tree reflects
> your reasoning.

Retire the handoff subsystem (defect 6). It spans more than the orchestrator, so
stage it rather than ripping it out:

| site | action |
|---|---|
| `handoffLines` injection at :250-257, :1102, :1309 | delete — this is the behaviour being removed |
| `runtime.handoffsByRole` (:87, :375-376, :1068, :1284) | delete |
| `registry.addHandoff` / `getHandoffsByRole` (`session-registry.ts:292`, `:307`) | keep the readers, drop the writer |
| `agency_handoffs` table (`db/schema.ts:41`) | leave in place, stop writing |

**Do not confuse the two rehydrations at this site.** Agency resume rebuilds the
whole `RuntimeAgency` — instances, `roleSlots`, `sdkToLocalId`, restart params,
reattached sessions. That stays, and phase 1 extends it to restore the new
`state` and `elastic` fields. Only the *handoff-summary* rehydration
(`registry.getHandoffsByRole` at :1270, consumed at :1309) is removed; it is the
same broadcast as :250-257, sourced from the DB rather than memory.

Dropping the read at :1309 is what stops the behaviour. Dropping the write alone
does not — a resumed agency would keep injecting summaries written before the
change.

Nothing is lost by removing it. Summaries are written only at flush time
(`requestHandoffAndSuspend` is the sole writer), so an instance that crashed
mid-task never produced one either; and a cleanly completed instance has
externalized to the repo, which survives a restart better than a DB row.

One real behaviour change, not a no-op: agencies resumed after this ships stop
receiving summaries written by the *old* code. That is intended — those describe
work whose reasoning is not in the tree, since it predates flushing — but it
does change what an in-flight agency sees across the upgrade.

Keep `sdkSessionId` and the on-disk transcript — forensics only, not routing.

### Phase 2 — drain on every release

Branch: `fix/agency-queue-drain`

Call the drain on both branches of :406, after the flush settles. Then widen the
drain itself: it currently shifts one entry and routes it to an idle instance
(:387-394), but under `min`/`max` a queued entry should be able to *trigger a
spawn* rather than wait. Make it reuse `routeMessage`'s resolution path — idle →
reserve → queue — rather than duplicating a narrower version.

Addresses defect 3.

### Phase 3 — floor enforcement and observability

Branch: `feat/agency-scaling-observability`

- On any lifecycle transition, if active instances for a role fall below `min`,
  spawn back up to `min`. Covers defect 5 and agent death (defect 5).
- `totalInstances` should describe the live population, with the ceiling stated
  separately if useful to the agent at all (defect 7).
- Regenerate `Current agency members` on scale events, or drop it. The elastic
  design depends on this list steering planner behaviour, so a stale list
  undermines the main benefit.
- Extend the routing log with lifecycle transitions — spawn, flush, retire,
  floor-restore — so scaling is legible in the same stream as routing.

## Rejected alternatives

Recorded so they are not relitigated.

- **Flat `count: max`.** Simpler and always warm, but the planner fills the
  parallelism it can see, so a flat count becomes a target rather than a
  ceiling. See "Why elastic at all".
- **Grow-only, never reclaim.** Avoids every reclaim hazard, but the pool
  ratchets to `max` and stays there, converging on flat-`count` in behaviour.
  Reasonable fallback if flush-on-reclaim proves unreliable in practice.
- **Resume-on-address** (reply attribution + per-instance queues + durable
  work-thread ids, so a caller can route follow-up work back to the instance
  that did it). Genuinely lossless, and it dodges relevance inference by making
  the caller name the target. Rejected as a large subsystem whose payoff is
  reclaiming near-free resources, and whose lossless context is often *stale*
  context. Revisit only if flush proves insufficient.
- **Relevance matching** — orchestrator infers which prior context suits new
  work. Rejected outright: the orchestrator has no basis for the judgement.

## Test protocol

Config under test. `count` must be **removed**, not merely supplemented, or it
wins at :1081:

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

Three checks the current code fails:

1. **Second wave.** Run the same prompt twice in one agency session. Wave 2
   should scale up again; today it queues, because the ceiling never releases
   (defect 1).
2. **Retired instances are not routed to.** After wave 1 reclaims, no `route`
   line should name a retired instance.
3. **Flush actually externalizes.** After a reclaim, the tree should contain the
   reasoning — comments or commit body — not just the code. This is the
   assumption the whole design rests on; if models flush poorly, fall back to
   grow-only.

Cross-check instance identity against persisted transcripts rather than the
planner's report — the planner's attribution has been wrong twice:

```sh
sqlite3 ~/Library/Application\ Support/AgentKeeper/agentkeeper.db \
  "select role_instance_index, sdk_session_id from agents
   where role_id='developer' order by started_at desc limit 5;"
# then read ~/.claude/projects/*/<sdk_session_id>.jsonl
```
