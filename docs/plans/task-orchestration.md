# Task orchestration: plan brief, multi-job plans, progress, push review

Inspired by FocusQueue's project → task → agent model. One slice, three parts
that reinforce each other.

## Model

A **Plan** is the task. Today a plan links one session (`plans.session_id`) and
carries steps, but agents can't read it back, can't report progress, and nothing
reviews their work before a push.

## 1. Plan brief + many jobs per plan

- `plans.brief` (markdown): the central document every job reads — goal, why,
  acceptance criteria, constraints. Editable in Planner detail.
- `plan_sessions(plan_id, session_local_id, step_id?, added_at)` join table
  replaces the single `plans.session_id` link. Migration backfills existing
  links. `plans.session_id` stays in the table (FK column; SQLite cannot drop
  it in place) but is no longer read or written.
- Planner detail gets a **Jobs** section: every linked session with role,
  branch, status, latest progress and review receipt. **New job** launches a
  solo session in a fresh worktree from the project's current branch, linked
  to the plan (optionally to a step), with a kickoff prompt that points it at
  `get_plan`.
- MCP `get_plan(id?)`: returns brief, steps, and each job's latest progress.
  Defaults to the plan linked to the caller's session.

## 2. Progress reporting

- `progress_reports(id, plan_id?, session_local_id, agent_local_id, step_id?,
  state, note, created_at)` — append-only log; latest row per agent is the
  current state.
- MCP `report_progress(state: working|blocked|done, note, stepId?)`. When
  `stepId` is given the step status follows (`working`→running,
  `done`→complete). Broadcast `progress:updated` to the renderer.
- Heartbeat expiry: a `working` report older than 10 minutes renders as
  **stale**, computed in the renderer — the DB records facts, not inferences.
- Shown on Planner Jobs rows and the session context panel.

## 3. Pre-push review gate

- MCP `review_push()`: collects the caller's worktree diff against its
  merge-base with the upstream default branch, runs a one-shot reviewer prompt
  on the session's harness (no tools, diff inlined, size-capped), and records a
  receipt `push_reviews(id, session_local_id, plan_id?, head_sha, verdict,
  summary, findings, created_at)`.
- Returns `APPROVED <sha>` or `CHANGES REQUESTED` plus findings. A receipt is
  only valid for the exact HEAD it reviewed; new commits invalidate it.
- Advisory gate in this slice: tool description and kickoff prompt tell the
  agent to call it before pushing. Planner Jobs rows show whether the current
  HEAD has an approved receipt.

## Deferred

- Hard enforcement (pre-push hook in app-created worktrees checking for a
  receipt).
- Safe worktree cleanup on plan completion.
- Unread-result inbox, monitor grid progress pills.
- Agency-role reviewer instead of one-shot prompt.

## Known gaps

- Only the Claude harness honours `disallowedTools` in one-shot prompts. Other
  harnesses (Codex runs with its sandbox bypassed) rely on the empty scratch cwd
  and the prompt's "no tools" instruction, not a hard restriction.
- If session launch fails after **New job** creates the worktree, the worktree
  is left behind for manual cleanup.
