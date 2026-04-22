# Orchestral-AI

Cross-platform Electron desktop app that drives the Claude Agent SDK from a
GUI, replacing the terminal `claude` workflow. End goal: Jira → worktree →
agent team → PR → merged, all from the app. Shipped so far (V0–V3): live
sessions, worktrees, roles, agencies with `send_message`, monitor grid.

## Stack

- Electron + Vite + Vue 3 + TypeScript
- Tailwind + Shadcn-Vue
- pnpm workspaces
- `@anthropic-ai/claude-agent-sdk` (spawns a bundled `claude` subprocess)
- Pinia for renderer state
- keytar for API-key storage in the OS keychain

## Monorepo layout

```
apps/desktop/               Electron shell (main + preload + Vue renderer)
apps/desktop/src/main/      Node — agent driver, IPC, git worktrees, secrets
apps/desktop/src/preload/   contextBridge — exposes typed `window.orchestral`
apps/desktop/src/renderer/  Vue app (views, components, composables, stores)
apps/desktop/src/shared/    IPC contract types — pure, no runtime imports
packages/core/              Session engine / Role-Agency engine (stub so far)
packages/sdk/               @orchestral/sdk — plugin contract (types-only)
packages/plugin-*/          Bundled plugins (coming V5: Jira, V6: GitHub)
```

**Plugin wall:** plugins import ONLY from `@orchestral/sdk`, never from
core. That boundary is enforced by convention now, by the loader later.

## Vocabulary

- **WorkItem** — external unit of work (Jira issue, GitHub issue, manual)
- **Job** — one Role + one Worktree + one Session, optionally linked to a WorkItem
- **Role** — reusable agent config; markdown file with YAML frontmatter
- **Agency** — named bundle of Roles with a routing topology

Roles live at `.orchestral/roles/<id>.md` (project) or
`~/.orchestral/roles/<id>.md` (global). Agencies at
`.orchestral/agencies/<id>.md`. Project scope wins on id collision.

## Vertical slices

- V0 ✅ monorepo + Electron/Vue shell
- V1 ✅ read-only session viewer (reads `~/.claude/projects/**/*.jsonl`)
- V2 ✅ live sessions via Agent SDK — 🎯 dogfood point
- V3 ✅ multi-session + worktrees + roles + agencies + monitor grid
- V4 skills + commands manager (wraps `npx skills`)
- V5 Jira plugin (wraps user's `jira` CLI, Jira Cloud)
- V6 GitHub plugin (PRs via `gh` CLI)

V2.1 (custom JSONL + SQLite dual-write) is intentionally deferred — the
SDK's own persistence is fine for now; revisit if it diverges from
`~/.claude/projects/`.

## Commands

```
pnpm dev          # start electron-vite dev server
pnpm typecheck    # vue-tsc --noEmit across all workspaces
pnpm build        # full production build
```

Typecheck and build before every commit.

## Commit format

```
<scope>: <short imperative subject>

<body: what changed and why. Call out deferred work or known gaps.>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Every commit gets the `Co-Authored-By` trailer.

## Agency workflow

Each slice or task = one agency run in a dedicated worktree
(`<project>--worktrees/<branch>/`). The `delivery-team` agency (planner,
developer, reviewer) is the default — user tasks enter the planner, which
delegates to the developer, consulting the reviewer on substantial work.
Fresh worktree per task keeps runs isolated.

Inter-agent messaging via `mcp__orchestral__send_message(to, content)`.
The orchestrator blocks the caller until the target idles; the target's
plain-text reply is returned as the caller's tool_result. Calling
`send_message` back at the peer that addressed you is a cycle and will be
rejected — reply with plain text, which is auto-captured.

## Gotchas

- **Auth**: Pro/Max plan (existing `claude login`) OR Anthropic Console key
  (keytar). Don't hardcode or read env for ANTHROPIC_API_KEY; go through
  the secrets store in `main/secrets.ts`.
- **IPC structured-clone**: never pass Vue Proxy objects, class instances,
  AbortControllers, or functions across IPC. `toRaw()` + spread, or JSON
  round-trip, before `ipcRenderer.invoke` or `webContents.send`.
- **Permission mode**: currently `'bypassPermissions'` — no prompt UI yet.
  Do not introduce a `canUseTool` callback; functions in SDK options
  can't cross its internal serialization boundary.
- **zod**: pinned to ^4 for SDK compatibility.

## What NOT to do

- Don't add SQLite or custom JSONL persistence — V2.1 is explicitly
  deferred until the SDK's own path diverges from what V1 reads.
- Don't push or force-push without explicit instruction.
- Don't edit from the `planner` role — it's tool-restricted for a reason.
- Don't reach into `packages/core` from a plugin. Only `@orchestral/sdk`.
- Don't write comments that describe WHAT code does — only non-obvious
  WHY. No file-level docstrings.
- Don't add backwards-compat shims for code that isn't shipped yet.
