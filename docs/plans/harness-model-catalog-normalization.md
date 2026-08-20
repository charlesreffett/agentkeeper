# Harness Model Catalog Normalization Plan

Status: implemented on `codex/harness-model-catalog-normalization`.

## Objective

Make model discovery, presentation, refresh, and live-session mutability a
harness-owned contract rendered through one consistent picker. Eliminate
adapter-formatted display strings, stale application-lifetime catalogs, and UI
branches that infer behavior from draft/live state or harness IDs.

The target flow is:

```text
harness-native discovery
  -> normalized structured model catalog
  -> refreshable per-harness snapshot
  -> capability-driven shared picker
  -> validated draft or live-session selection
```

## Motivation

The session composer branch exposed three related weaknesses:

- OpenCode combined context and price metadata into one `description` string,
  leaving the renderer unable to present one without the other.
- Draft and active sessions temporarily used different model-list components,
  causing their selection behavior and visuals to diverge.
- Model catalogs are cached for the application lifetime, so adapter metadata
  changes and upstream model changes can remain stale until restart.

T3 Code demonstrates useful boundaries without requiring AgentKeeper to adopt
its full provider-instance or event-sourced registry architecture: normalize
provider-native data at the adapter boundary, expose structured capabilities,
and keep clients ignorant of provider-specific protocols.

## Scope

This plan includes:

1. Structured model presentation metadata, beginning with context-window size.
2. Explicit model-selection mutability in `HarnessCapabilities`.
3. One execution-target/model picker for drafts and active sessions.
4. Refreshable, observable model snapshots with stale/error state.
5. A normalized path for configured custom model IDs.

This plan deliberately defers configurable harness instances (multiple Claude,
Codex, or OpenCode accounts/endpoints). That requires identity, settings,
credential, persistence, and routing decisions beyond model discovery. Add it
only when a concrete multi-account or custom-endpoint requirement exists.

## Contract design

### Structured model metadata

Replace presentation-bearing `description` usage with fields the renderer can
format intentionally:

```ts
export interface HarnessModelInfo {
  value: string
  label: string
  provider?: string
  resolvedModel?: string
  contextWindow?: number
  isDefault?: boolean
  isCustom?: boolean
  controls?: SessionControlDescriptor[]
}
```

Keep `description` temporarily during migration only if a harness supplies
genuinely descriptive prose. Do not use it for synthesized pricing, context,
or capability summaries. Pricing belongs to the cost-accounting surface, not
the execution-target picker.

`AvailableModel` in the IPC contract must mirror the normalized fields. The
renderer owns compact formatting such as `200K context` and must omit absent
metadata without inventing fallback facts.

### Model mutability

Extend `HarnessCapabilities` with a small explicit contract:

```ts
modelSelection: 'draft-only' | 'idle' | 'turn'
```

- `draft-only`: selection is fixed after launch.
- `idle`: selection may change between turns but not while a turn is running.
- `turn`: the harness can accept a model change for the next/in-progress turn
  according to its adapter semantics.

The main process remains the authority. Renderer disabling is explanatory UX,
not the enforcement boundary. Every `setModel` entry point must reject changes
outside the declared mutability state with a typed reason.

### Model snapshot

Replace the bare per-harness `ModelsListResult` cache with an observable
snapshot:

```ts
export interface HarnessModelSnapshot {
  harnessId: string
  models: AvailableModel[]
  status: 'cached' | 'refreshing' | 'ready' | 'error'
  refreshedAt: number | null
  error?: string
}
```

The main process owns discovery and caching. Renderer queries consume the
snapshot and receive an invalidation/update event after refresh. Preserve the
last successful catalog during a refresh error so a transient provider failure
does not empty the picker.

## Implementation phases

### Phase 0 — Characterization tests

- Lock the current Claude Code and OpenCode model normalization behavior with
  adapter-level tests.
- Cover default resolution, provider grouping, context formatting, unknown
  metadata, and custom model validation.
- Add renderer tests proving draft and active sessions render the same model
  rows and selection state.
- Add main-process tests for allowed and rejected live model changes.

No production contract changes land in this phase.

### Phase 1 — Structured catalog contract

- Add `contextWindow` and `isCustom` to core and IPC model contracts.
- Populate OpenCode context from `model.limit.context` without constructing a
  display description.
- Map any authoritative Claude SDK context metadata when available; otherwise
  leave it absent rather than maintaining a guessed table.
- Add a renderer formatter for compact token counts and use it in
  `ExecutionTargetPicker`.
- Remove adapter-generated capability/price strings after all consumers use
  structured fields.

Migration rule: accept an optional legacy `description` for one release, but
do not generate new structured information by parsing that string.

### Phase 2 — Capability-driven mutability

- Add `modelSelection` to every harness capability declaration.
- Backstop `sessions.setModel` and agency fallback-model changes in the main
  process using the declared capability and current session/turn state.
- Replace renderer `isDraft`/status inference with a helper that resolves
  whether model selection is enabled and why.
- Show disabled explanatory text for immutable states instead of removing the
  picker.
- Verify that harness switching and agency selection remain draft-only even
  when model switching is allowed live.

### Phase 3 — Shared picker completion

- Keep `ExecutionTargetPicker` as the only composer model-list implementation.
- Replace independent booleans with a capability object:

  ```ts
  {
    canSwitchHarness: boolean
    canSelectAgency: boolean
    canSwitchModel: boolean
    disabledReason?: string
  }
  ```

- Preserve identical row layout, search, default indication, keyboard
  navigation, provider grouping, and context metadata across draft and live
  sessions.
- Keep lifecycle-specific actions unavailable without creating a second visual
  implementation.
- Audit settings and Jira launch surfaces for duplicate model-list behavior;
  reuse the shared row/content primitives where the full execution-target
  picker is inappropriate.

### Phase 4 — Refreshable snapshots

- Refactor `main/models.ts` to store the last successful snapshot per harness.
- Add stale-time refresh on picker open and retain explicit refresh IPC.
- Broadcast snapshot updates so TanStack Query caches update without restart.
- Deduplicate concurrent refreshes per harness.
- Preserve last-known-good models on discovery failure and expose the error as
  non-destructive picker status.
- Invalidate the catalog when the active harness configuration or relevant
  authentication state changes.

Do not add persistent disk caching in the first implementation. The model list
is small, discovery already occurs at startup, and persistence adds schema and
staleness concerns without solving an observed startup problem.

### Phase 5 — Custom model normalization

- Add per-harness configured custom model IDs only where the harness can honor
  off-catalog identifiers.
- Normalize, deduplicate, and length-limit IDs before merging them after the
  discovered catalog.
- Mark custom entries explicitly and assign conservative capabilities rather
  than borrowing unrelated model metadata.
- Keep strict live-list validation for harnesses that reject unknown IDs.
- Add settings UI only after at least one real custom-model use case is
  confirmed.

## Verification matrix

| Scenario | Expected behavior |
| --- | --- |
| OpenCode model with context and zero cost | Context shown; price omitted |
| Model with no context metadata | No fabricated context subtitle |
| Catalog refresh succeeds | Rows update without app restart |
| Catalog refresh fails | Last-known-good rows remain; error is visible |
| Draft model change | Allowed for every model-capable harness |
| Idle live model change | Allowed only for `idle` or `turn` capability |
| Running live model change | Allowed only for `turn` capability |
| Harness switch on live session | Rejected; harness remains fixed |
| Agency selected | Session-level controls follow agency ownership rules |
| Explicit custom model | Shown only for a harness that supports it |

Run desktop typecheck and focused adapter, IPC, store, and picker tests after
each phase. Finish with manual verification against both Claude Code and
OpenCode because their discovery and live-mutation semantics differ.

## Likely files

- `packages/core/src/harness/types.ts`
- `apps/desktop/src/shared/ipc-contract.ts`
- `apps/desktop/src/main/models.ts`
- `apps/desktop/src/main/harness/claude-code.ts`
- `apps/desktop/src/main/harness/opencode.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/renderer/src/composables/useModelsQuery.ts`
- `apps/desktop/src/renderer/src/composables/useHarnessCapabilities.ts`
- `apps/desktop/src/renderer/src/components/ExecutionTargetPicker.vue`
- `apps/desktop/src/renderer/src/views/LiveSessionView.vue`
- `apps/desktop/src/renderer/src/stores/sessions.ts`

## Completion criteria

- Harness adapters report facts and capabilities, not preformatted picker
  summaries.
- Draft and active sessions use one model-list implementation.
- Live model changes are enabled and enforced from declared mutability.
- Catalog changes appear without restarting AgentKeeper.
- Refresh failures do not erase a usable catalog.
- No renderer decision branches on a concrete harness ID.
- Multi-instance harness support remains explicitly deferred rather than being
  partially introduced through model-cache keys alone.
