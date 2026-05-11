---
name: Delivery Team
description: Planner decomposes, developer implements, reviewer verifies
roles:
  - planner
  - id: developer
    count: 3
  - reviewer
flows:
  - - reviewer
    - planner
  - - planner
    - developer
  - - developer
    - reviewer
entryPoints:
  - planner
---

Standard three-role team for delivering slices and substantial tasks
against the agentkeeper project itself.

## Protocol

- User tasks enter through the **planner**, which decomposes, researches,
  and delegates one step at a time to the **developer**.
- The **developer** executes the step, runs typecheck + build, commits,
  and replies with a concise summary.
- The **reviewer** is consulted for substantial changes — by the planner
  (architectural review) or the developer (diff review before commit).
  The reviewer can't edit; it reports findings back for the developer to
  address.
- Flows are open (any-to-any). The orchestrator's cycle detector blocks
  deadlocks — if a peer addresses you, reply with plain text, which is
  auto-captured as their tool_result. Don't `send_message` back.

## Suggested usage

- One agency run per slice / task, in a dedicated worktree (branch like
  `v4-skills-manager`, `v3-polish`, etc.). Fresh runs keep context tight.
- Small one-off fixes don't need an agency — pick the `developer` role
  directly from **New Session** instead.
- When starting: give the planner the full task spec in the initial
  prompt, including acceptance criteria, any constraints, and links to
  the relevant slice in `CLAUDE.md`.
