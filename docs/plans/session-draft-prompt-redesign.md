# Session Draft and Prompt Redesign Plan

Rework the desktop session draft into a compact, harness-agnostic composer that
separates launch context from controls that remain meaningful after a session
starts. This document is an implementation prompt and plan only; it does not
authorize product implementation.

---

## Implementation prompt

Redesign AgentKeeper's desktop session draft and prompt surface using the nine
provided reference screenshots and the T3 Code source references below.

The result must have two visually and behaviorally distinct bands:

1. **Launch context above the prompt** — project, branch, and an adjoined
   worktree checkbox. These controls configure where a new session starts and
   appear only while composing a new session.
2. **Session controls below the prompt** — an execution-target picker (model
   or agency), model-derived effort and advanced traits when running a model,
   permission policy, and interaction mode. These controls configure how
   the harness runs and remain available during a session only when the active
   execution target can change them safely.

Do not hard-code Codex, Claude, OpenCode, or future harness IDs in renderer
decision logic. Harness adapters must advertise supported controls, choices,
defaults, descriptions, and mutability. The renderer must project those
descriptors into a consistent UI and gracefully render or omit unknown and
unsupported controls.

Preserve prompt text, attachments, role/agency behavior, MCP selection,
keyboard submission, command autocomplete, no-project sessions, and guarded
Git branch operations. Do not make an agency appear to support session-level
controls that its individual roles actually own.

---

## Reference reading and conclusions

### Screenshot conclusions

The supplied screenshots establish the following requirements:

- With no project selected, show a single **Choose project** control above the
  prompt. The prompt itself remains usable for a general/no-project session.
- The project picker is a searchable popover of recent projects with a **New
  project** action.
- After project selection, show a flat context strip containing the project
  name and branch. Omit the Codex-specific **Local** label.
- The branch picker is searchable, identifies the selected branch, and offers
  **Create and checkout new branch…**.
- Place a worktree checkbox directly beside the branch control, as one joined
  branch/worktree unit rather than a detached footer pill.
- Keep model/effort/permission/mode controls below the prompt. Codex and Claude
  expose different effort choices and secondary traits; the UI must reflect
  those differences instead of presenting one global effort enum.
- Permission and mode are different concepts. Permission controls approval and
  filesystem/command autonomy; mode controls the agent's working behavior such
  as Build versus Plan.
- Use compact triggers and richer popovers: concise current values in the
  footer, descriptive option rows and default badges inside menus.

### T3 Code conclusions

Reviewed against T3 Code commit
[`36f4314`](https://github.com/pingdotgg/t3code/tree/36f4314ab768dca3fc20af6ac25e7011b4b0447f).

- T3's model contract represents provider traits as generic `select` and
  `boolean` descriptors with IDs, labels, descriptions, choices, current
  values, and defaults. See
  [`packages/contracts/src/model.ts`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/packages/contracts/src/model.ts).
- Shared code resolves selections against those descriptors without knowing
  which provider supplied them. See
  [`packages/shared/src/model.ts`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/packages/shared/src/model.ts).
- Codex derives reasoning and service-tier choices from its live model catalog
  rather than a UI-owned list. See
  [`CodexProvider.ts`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/apps/server/src/provider/Layers/CodexProvider.ts).
- Claude models advertise a different descriptor set, including effort,
  context window, and model-specific booleans such as fast mode. See
  [`ClaudeProvider.ts`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/apps/server/src/provider/Layers/ClaudeProvider.ts).
- The composer renders provider traits from descriptors and persists generic
  selections. See
  [`composerProviderState.tsx`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/apps/web/src/components/chat/composerProviderState.tsx)
  and
  [`TraitsPicker.tsx`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/apps/web/src/components/chat/TraitsPicker.tsx).
- T3 keeps normalized runtime permission policy separate from provider
  interaction mode. See
  [`packages/contracts/src/orchestration.ts`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/packages/contracts/src/orchestration.ts)
  and
  [`ChatComposer.tsx`](https://github.com/pingdotgg/t3code/blob/36f4314ab768dca3fc20af6ac25e7011b4b0447f/apps/web/src/components/chat/ChatComposer.tsx).

Adopt the descriptor boundary, not every T3 special case. AgentKeeper's generic
renderer should not identify important controls by provider name, and unknown
descriptor IDs must remain usable through a generic advanced-controls section.

### AgentKeeper findings

- `LiveSessionView.vue` currently owns model, effort, permission, agency, and
  worktree controls and injects them into `MessageInput.vue`'s single footer.
- Project context currently lives in the session header through `ScopeBar.vue`,
  while draft branch selection is absent there (`show-branch-switcher="!isDraft"`).
- `DraftSessionConfig.branch` exists but the current draft UI never supplies a
  proper branch picker. Model promotion creates a worktree only when both
  `useWorktree` and a non-empty branch string are present.
- `worktrees.create(projectPath, branchRequest)` treats the request as the name
  of a new branch and always branches from the repository's current `HEAD`; it
  cannot accurately express “create a worktree from the selected base branch.”
- `RoleEffort` and `ROLE_EFFORT_VALUES` are global fixed unions. OpenCode is
  given the same fallback effort menu even though its adapter declares
  `effort: false`.
- `PermissionMode` contains `plan`, conflating interaction mode with approval
  policy, and its values are Claude SDK terms rather than an app-level
  harness-neutral contract.
- `HarnessCapabilities` exposes booleans only. It can say that a harness has
  effort or permission support, but cannot advertise supported values,
  defaults, descriptions, model-specific differences, or live mutability.
- Draft text and attachments are persisted, but renderer-only launch/control
  configuration is not part of the draft persistence payload.

---

## Target experience

### Draft composer

```text
┌──────────────────────────────────────────────────────────────┐
│ [folder agentkeeper]  [branch main │ □ worktree]            │
├──────────────────────────────────────────────────────────────┤
│ Type the first message…                                     │
│                                                              │
│ [ + ] [Run with ▾] [Effort/traits ▾] [Permission ▾] [Mode ▾] │
│                                                         [↑]  │
└──────────────────────────────────────────────────────────────┘
```

When no project is selected, the first row contains only **Choose project**.
Branch and worktree controls appear after the chosen directory is confirmed to
be a Git repository. Non-Git projects retain the project control but show no
fake/detached branch state.

### Live composer

The launch-context row is removed after promotion. Project, branch, and
worktree become read-only session context in the existing session header or
context panel; they are not repeated as editable prompt controls. For a model
session, the footer keeps execution-target/model-traits/permission/mode
controls that the harness advertises as live-mutable. For an agency, it shows
the agency identity without implying that one session-level model controls all
members. A fixed-at-start control remains visible only if its disabled state
and explanation are useful; otherwise omit it.

### Project picker

- Search registered projects by name and path.
- Sort by recency and disambiguate duplicate names with a compact parent path.
- Show only the project name in the selected launch-toolbar control; keep paths
  inside the picker for search and duplicate-name disambiguation.
- Keep **New project…** and project management actions after a separator.
- Selecting a project retargets the current draft without creating a second
  draft or losing prompt text/attachments.
- General/no-project is the initial state, not a selectable fake project row.

### Branch and worktree unit

- Default the draft's base branch to the selected repository's current branch.
- Search local branches; group default, pinned, and recent branches using the
  existing `BranchInfo` data. Keep worktree occupancy visible.
- Offer an explicit create-branch flow. Validate the name before promotion and
  keep errors attached to the draft composer.
- Branch browsing must not mutate the working copy. Apply the selected checkout
  only when the user confirms a branch action or sends the first prompt.
- With worktree **off**, the selected branch is the checkout in which the
  session will run. Use the existing dirty-tree/conflict/live-session guards
  before promotion and keep the draft intact if switching is rejected.
- With worktree **on**, the selected branch is the **base ref**, not the new
  worktree branch name. Create a unique worktree branch from that exact ref.
  Extend the backend request to carry `baseRef` separately from
  `branchRequest`; never silently branch from whichever `HEAD` happens to be
  current.
- Generate a safe default worktree branch request from the draft/session ID and
  prompt-derived slug, while allowing the create-branch flow to provide an
  explicit name. Surface the final branch after creation.
- Use the same semantics for model and agency promotion. No-project sessions
  never show or create worktrees.

### Footer controls

- Replace the standalone model picker and agency picker with one **Run with**
  execution-target picker. It is one control because the choices are mutually
  exclusive, not because an agency is a kind of model.
- The picker has two clearly labeled top-level sections: **Models** and
  **Agencies**. Within **Models**, group choices by harness using the existing
  ModelPicker pattern: a compact vertical harness-tab rail beside the model
  results. The rail and results pane scroll vertically and independently, so
  an open-ended number of harnesses does not reduce the horizontal space
  available to model names and metadata. Each harness tab lists only the models
  advertised by that adapter. Preserve both levels of labeling while searching
  and navigating by keyboard.
- Give the **Models** and **Agencies** panels the same stable viewport height,
  approximately matching the current `ModelPicker` popover. Each panel owns its
  overflow so switching target tabs never resizes or shifts the picker.
- In model state, the trigger shows the provider/model identity. In agency
  state, it shows the agency icon/name plus a compact summary such as “3 roles
  · assigned models” or “mixed harnesses.” Never display the previously chosen
  model as if it applied to the agency.
- Model and agency state is a discriminated union. Selecting an agency suspends
  the model selection instead of overwriting it; switching back to Models
  restores the user's last compatible harness/model and trait selections.
- Selecting an agency hides model-specific traits, permission, and interaction
  mode when those values are owned or forced by agency roles. A live agency
  shows its agency identity read-only rather than offering a misleading model
  change.
- Agency selection runs a preflight over every role and shows a concise model
  summary or actionable warning. An agency role's explicit harness/model/effort
  wins. A missing model resolves to the advertised default of that role's
  effective harness, never to the hidden previous model. A missing harness
  uses the agency launch harness/default explicitly captured for the draft.
- Keep harness/model selection inside the Models section. Vertical harness tabs
  are derived from available adapters rather than hard-coded in the renderer.
  Changing harness or model recomputes the descriptor set and resets only
  selections that are invalid for the new combination.
- Render the descriptor categorized as `effort` as the compact primary traits
  trigger. Its popover may also group related model traits such as context
  window, service tier/speed, or boolean toggles.
- Render normalized permission policy separately with concise labels and
  explanatory descriptions modeled on the reference screenshots.
- Render interaction mode separately (for example Build/Plan), only when the
  adapter advertises more than one choice.
- Put unrecognized provider/model descriptors under **Advanced** in the same
  traits menu. Unknown descriptors must not be discarded just because the
  renderer has no custom icon for their category.
- Mark provider/model defaults in option menus. The trigger shows the selected
  human label, not a raw harness value.
- Hide unsupported controls rather than displaying global fallback options the
  harness will ignore.
- Agency drafts no longer have a second agency pill. The execution-target
  picker is the sole authority, and session-level effort/permission/mode
  controls are hidden or locked when role definitions own those values.
  Explain the constraint in the picker and agency summary.

---

## Harness-agnostic control contract

Replace renderer-owned enumerations with adapter-owned descriptors. Use one
generic selection shape for model traits and app-level contracts for the two
cross-harness concepts that need stable product semantics.

```ts
type ControlValue = string | boolean

interface ControlChoice {
  value: string
  label: string
  description?: string
  isDefault?: boolean
}

type ControlCategory =
  | 'effort'
  | 'permission'
  | 'mode'
  | 'context'
  | 'speed'
  | 'advanced'

type SessionControlDescriptor =
  | {
      id: string
      category: ControlCategory
      label: string
      description?: string
      type: 'select'
      choices: ControlChoice[]
      defaultValue?: string
      mutable: 'draft' | 'idle' | 'turn'
    }
  | {
      id: string
      category: ControlCategory
      label: string
      description?: string
      type: 'boolean'
      defaultValue?: boolean
      mutable: 'draft' | 'idle' | 'turn'
    }

interface SessionControlSelection {
  id: string
  value: ControlValue
}

interface ModelSelection {
  model: string
  options: SessionControlSelection[]
}

type DraftExecutionTarget =
  | {
      kind: 'model'
      harnessId: string
      modelSelection: ModelSelection
    }
  | {
      kind: 'agency'
      agencyKey: string
      /** Explicit fallback only for roles that do not declare a harness. */
      defaultHarnessId: string
    }
```

The exact names may change during implementation, but preserve these
boundaries:

- `HarnessModelInfo` / `AvailableModel` carries model-specific descriptors.
- `HarnessInfo` carries harness/session descriptors such as permission and
  interaction mode.
- `StartSessionParams` and `HarnessSessionOptions` carry generic validated
  selections rather than assuming every harness accepts `RoleEffort` and
  Claude `PermissionMode` values.
- The adapter validates selections against its own advertised descriptors and
  maps them to native SDK/CLI options. Unknown IDs are rejected at the harness
  boundary with an actionable error; they are never forwarded to argv.
- Renderer placement depends on descriptor category and mutability, never on
  `harnessId`. Category is presentation metadata, not required for correctness:
  an unknown category falls back to **Advanced**.
- Permission policy and interaction mode remain distinct in persisted session
  state even if an adapter must combine them into one native setting. For
  example, the Claude adapter resolves the selected Build/Plan mode and
  approval policy into the SDK's native `permissionMode` at the boundary.
- Capability booleans may remain for coarse feature gates such as agencies,
  but descriptor presence is the source of truth for composer controls.

Do not invent Codex effort levels or Claude context windows in shared UI code.
Use live model metadata when the adapter provides it. If an adapter cannot
discover a control dynamically, its adapter may own a versioned static catalog;
the renderer still consumes only descriptors.

---

## Draft state and persistence

Introduce one serializable draft payload rather than splitting prompt content
from renderer-only launch configuration:

```ts
interface SessionDraftPayload {
  prompt: string
  attachments: Attachment[]
  projectPath: string | null
  baseBranch: string | null
  useWorktree: boolean
  requestedBranch: string | null
  executionTarget: DraftExecutionTarget
  /** Restored if the user changes an agency draft back to Models. */
  lastModelTarget: Extract<DraftExecutionTarget, { kind: 'model' }> | null
  controlSelections: SessionControlSelection[]
  roleId: string
  mcpServerIds: string[]
}
```

- Persist the payload on meaningful changes with debouncing; do not write on
  every keystroke synchronously.
- Restore it only after validating the project still exists, the branch is
  still available, and selections remain supported by the current harness
  descriptors.
- Retargeting project clears branch/worktree state scoped to the old project
  but preserves prompt, attachments, the model execution target, and compatible
  session controls. Revalidate or clear a project-scoped agency selection.
- Changing harness/model preserves selections whose descriptor ID and value
  remain valid and resets the rest to advertised defaults.
- Changing Models → Agency preserves the model target only as inactive draft
  memory. It is not submitted to agency launch. Changing Agency → Models restores
  that target after revalidation.
- Clear the draft only after session/worktree creation succeeds. A rejected Git
  operation or harness start keeps every field and attachment recoverable.
- Continue supporting the desktop's existing “one focused draft per project
  context” behavior unless product requirements explicitly change it.

---

## Implementation phases

### Phase 0 — Lock contracts and behavior with tests

- [ ] Add pure tests for descriptor default resolution, selection validation,
      harness/model changes, unknown advanced descriptors, and mutability.
- [ ] Add execution-target tests for Models ↔ Agency switching, restoration of a
      compatible model, and proof that hidden model selections never reach
      agency launch.
- [ ] Add agency preflight tests for assigned models, mixed harnesses, missing
      role models, unavailable harnesses, and adapter defaults.
- [ ] Add pure tests for draft project retargeting and branch/worktree state.
- [ ] Add worktree tests proving a selected `baseRef` is honored even when the
      main checkout is on a different branch.
- [ ] Define the Claude adapter's permission-policy × interaction-mode mapping
      table and test every supported pair.
- [ ] Confirm which existing controls are draft-only, idle-mutable, or
      turn-mutable before changing UI.

**Outcome:** behavior is explicit before renderer and persistence changes.

### Phase 1 — Descriptor and session-state contracts

- [ ] Add descriptor/selection/model-selection types to
      `packages/core/src/harness/types.ts` and export them through core.
- [ ] Extend `HarnessModelInfo` and `AvailableModel` with generic option
      descriptors; replace `effortLevels`, `supportsFastMode`, and similar
      one-off presentation fields once their callers are migrated.
- [ ] Extend `HarnessInfo` with harness-level permission/mode descriptors.
- [ ] Replace `StartSessionParams.effort` and Claude-specific
      `permissionMode` as the canonical path with model/control selections.
- [ ] Persist model options, normalized permission policy, and interaction mode
      on the session. Add a SQLite migration/backfill from existing `model`,
      `effort`, and `permission_mode` rows so historical sessions remain
      readable.
- [ ] Add typed IPC methods for changing mutable controls on an idle/live
      session; validate in main before restart/turn dispatch.
- [ ] Keep the current mobile/iOS request shape operational during this desktop
      slice, translating it at the main-process boundary. A mobile descriptor
      UI is a separate follow-up, not a reason to keep desktop UI hard-coded.

**Outcome:** the renderer can ask what controls exist and submit generic
selections without knowing the harness.

### Phase 2 — Adapter metadata and native mapping

- [ ] Claude Code adapter: derive supported effort choices from
      `supportedModels()`, advertise permission and interaction-mode choices,
      and map normalized selections to SDK options at `runSession()`.
- [ ] OpenCode adapter: advertise only controls it can actually honor. Do not
      expose the global effort or permission list while its current adapter
      declares those capabilities false.
- [ ] Ensure future adapters can add model traits, permission policies, and
      modes by returning descriptors and consuming selections without renderer
      edits.
- [ ] Update model caching and `useModelsQuery` so descriptor metadata changes
      invalidate derived selections correctly.
- [ ] Backstop every entry point—desktop, mobile, agencies, resume, and
      edit/rerun—with the same adapter validation.

**Outcome:** supported values come from the selected harness/model and are
faithfully mapped at one boundary.

### Phase 3 — Correct launch-context semantics

- [ ] Change `worktrees.create` to accept an object containing `baseRef` and
      `branchRequest`; create with `git worktree add -b <branch> <path>
      <baseRef>`.
- [ ] Add validation for missing/stale base refs, occupied branches, invalid
      names, and paths already represented by a worktree.
- [ ] Extract draft-safe branch selection from `BranchSwitcher.vue`; reuse its
      search/grouping rows without its pull/push/commit actions.
- [ ] Defer checkout mutation until branch action confirmation or draft
      promotion. Reuse existing dirty/conflict/live-session results and render
      failures in the composer.
- [ ] Apply identical base-branch/worktree behavior in model and agency launch
      paths.
- [ ] Resolve the current bug where `defaultUseWorktree: true` plus an empty
      draft branch silently launches without a worktree.

**Outcome:** the compact branch/worktree UI has unambiguous, safe Git behavior.

### Phase 4 — Draft composer components

- [ ] Refactor `MessageInput.vue` into a composer surface with explicit
      `context`, `body`, and `footer` regions rather than injecting everything
      into one footer slot.
- [ ] Add a draft-only `SessionLaunchContext.vue` for project and joined
      branch/worktree controls.
- [ ] Add generic `SessionControls.vue` / `ModelTraitsPicker.vue` components
      that render descriptors and generic advanced controls.
- [ ] Replace `ModelPicker.vue` plus the separate agency pill with a unified
      `ExecutionTargetPicker.vue`. Reuse model-picker internals for the Models
      section, but keep agency rows visually and semantically distinct.
- [ ] Move draft project selection from the page header into the composer.
      Keep read-only live context in the header/context panel.
- [ ] Preserve attachments, paste handling, command autocomplete, autofocus,
      keyboard hints, stop/send behavior, and narrow-width horizontal overflow.
- [ ] Make the prompt textarea non-resizable by the user. Grow it automatically
      from its minimum line height as lines are added, then keep a fixed maximum
      height and scroll its contents internally.
- [ ] Keep role and MCP launch controls out of the project/branch row. Agency
      selection belongs exclusively in the execution-target picker; do not
      retain a duplicate agency footer control.
- [ ] Use accessible names, keyboard navigation, focus return, checked/selected
      semantics, and tooltips/descriptions for compact icon controls.

**Outcome:** the visual hierarchy matches the references while remaining
usable across harnesses and window widths.

### Phase 5 — Unified draft promotion and persistence

- [ ] Replace `DraftSessionConfig` plus separately persisted prompt fields with
      the serializable draft payload.
- [ ] Update `createOrFocusDraft`, `retargetDraft`, `promoteDraft`, and draft
      teardown to use one validated snapshot.
- [ ] Make promotion transactional from the renderer's perspective: validate
      project/Git/control state, prepare checkout/worktree, start the harness,
      then clear/convert the draft.
- [ ] If harness start fails after creating a new worktree, report the created
      path and offer recoverable cleanup; do not silently delete a worktree that
      may contain user changes.
- [ ] Ensure live session control changes respect descriptor mutability and the
      existing idle-session restart behavior.

**Outcome:** draft recovery and launch behavior are consistent, with no silent
loss of prompt or configuration.

### Phase 6 — Verification and polish

- [ ] Component-test no-project, non-Git project, Git project, worktree on/off,
      branch-create, and unsupported-control states.
- [ ] Test at least Claude Code and OpenCode to prove the UI differs by
      advertised capabilities without harness-ID branches in the renderer.
- [ ] Test an artificial descriptor with an unknown ID/category to verify the
      generic Advanced fallback.
- [ ] Verify draft restoration, project retargeting, model/harness switching,
      promotion errors, session resume, and idle live-control changes.
- [ ] Verify agency drafts do not imply session-level permission/effort control.
- [ ] Verify the execution-target picker clearly distinguishes Models from
      Agencies, groups models behind an independently scrollable vertical rail
      of adapter-derived harness tabs, keeps both target panels the same height,
      and permits exactly one active target.
- [ ] Verify selecting an agency prevents stale model/trait/control
      selections from reaching `agencies.start` while preserving them for a
      later switch back to Models.
- [ ] Verify agency rows summarize resolved role models and warn about
      unavailable or unresolved role harnesses before launch.
- [ ] Run `pnpm typecheck` and `pnpm build`.
- [ ] Manually compare the implementation at compact and wide desktop widths
      against all nine supplied screenshots, including focus, hover, open-menu,
      disabled, loading, and error states.

**Outcome:** the redesign is visually coherent, safe around Git, and proven
harness-agnostic.

---

## Acceptance criteria

- [ ] New drafts show project/branch/worktree above the prompt and the execution
      target plus applicable traits/permission/mode below it.
- [ ] Live composers do not show editable project/branch/worktree launch
      controls.
- [ ] The project and branch popovers are searchable and keyboard accessible.
- [ ] The selected project strip omits **Local**.
- [ ] Worktree is visually adjoined to branch selection.
- [ ] Worktrees start from the explicitly selected base ref and receive a
      unique new branch.
- [ ] Selecting/browsing a branch does not unexpectedly mutate the working
      copy, and rejected Git operations leave the draft intact.
- [ ] Effort and secondary trait options match the selected harness/model's
      descriptors; unsupported options are not shown.
- [ ] Permission policy and interaction mode are separate in UI, persistence,
      and adapter input.
- [ ] Renderer control logic contains no Codex/Claude/OpenCode ID checks.
- [ ] Unknown descriptors remain usable through a generic Advanced section.
- [ ] Harness/model switching preserves valid selections and resets invalid
      ones to advertised defaults.
- [ ] The execution-target picker presents visually distinct **Models** and
      **Agencies** sections, groups models behind a vertically scrollable
      harness rail, keeps a stable height when switching sections, and permits
      exactly one active target.
- [ ] Agency selection replaces the model identity in the trigger, hides
      inapplicable model controls, and never submits the inactive model.
- [ ] Switching back to Models restores the last compatible model and trait
      selections.
- [ ] Agency role models are summarized before launch; missing role models use
      their effective harness defaults rather than the inactive model.
- [ ] Prompt text, attachments, and launch/control state survive draft
      navigation and restoration.
- [ ] Model, role, and agency launches retain existing supported behavior and
      receive the same Git validation.
- [ ] No-project and non-Git sessions remain first-class and show no phantom Git
      controls.
- [ ] Typecheck, build, focused unit/component tests, and manual visual QA pass.

---

## Out of scope

- Recreating the exact visual styling of any one reference application.
- Adding a Codex adapter solely for this redesign.
- Redesigning role and agency definition editors around generic model options;
  this plan only prevents the session composer from misrepresenting role-owned
  controls.
- Redesigning the iOS/mobile composer; maintain its current contract at the
  main-process boundary and plan descriptor-driven mobile UI separately.
- Changing transcript rendering, sidebar organization, planner UX, or session
  history semantics.
- Pull/push/commit operations inside the draft branch picker.
- Automatically deleting worktrees after a failed launch.

---

## Likely files touched

| Area | Files |
|------|-------|
| Harness contracts | `packages/core/src/harness/types.ts`, `packages/core/src/index.ts` |
| Shared IPC/session types | `apps/desktop/src/shared/ipc-contract.ts` |
| Adapter metadata/mapping | `apps/desktop/src/main/harness/claude-code.ts`, `apps/desktop/src/main/harness/opencode.ts`, `apps/desktop/src/main/models.ts` |
| Session persistence | `apps/desktop/src/main/db/schema.ts`, a new migration, `apps/desktop/src/main/session-registry.ts`, `apps/desktop/src/main/drafts.ts` |
| Session execution | `apps/desktop/src/main/agent.ts`, `apps/desktop/src/main/orchestrator.ts`, `apps/desktop/src/main/ipc.ts`, `apps/desktop/src/preload/index.ts` |
| Git/worktrees | `apps/desktop/src/main/worktrees.ts`, `apps/desktop/src/main/git.ts`, `apps/desktop/src/renderer/src/composables/useGitBranches.ts` |
| Draft/session state | `apps/desktop/src/renderer/src/stores/sessions.ts`, `apps/desktop/src/renderer/src/composables/useModelsQuery.ts`, `apps/desktop/src/renderer/src/composables/useHarnessCapabilities.ts` |
| Composer UI | `apps/desktop/src/renderer/src/components/MessageInput.vue`, `apps/desktop/src/renderer/src/views/LiveSessionView.vue`, `apps/desktop/src/renderer/src/views/SessionsWorkspace.vue` |
| New/reused UI | new launch-context, `ExecutionTargetPicker.vue`, and generic-control components; refactored `BranchSwitcher.vue`, `ScopeBar.vue`, `ModelPicker.vue`, and `PillSelect.vue` as appropriate |
| Mobile compatibility | `apps/desktop/src/main/mobile-server.ts` plus contract tests only; no mobile visual redesign |

---

## Recommended sequencing

```text
Contract tests
    ↓
Descriptor contracts → adapter metadata/mapping
    ↓                         ↓
Draft persistence      Git base-ref/worktree semantics
    └──────────────┬──────────┘
                   ↓
          Composer component redesign
                   ↓
          Promotion/live mutation wiring
                   ↓
             Cross-harness QA
```

Keep phases 1–3 reviewable independently from the visual refactor. The UI
should consume the final descriptor and Git semantics rather than landing a
temporary harness-specific implementation that must be replaced immediately.
