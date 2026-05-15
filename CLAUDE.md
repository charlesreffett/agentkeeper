# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# AgentKeeper

Cross-platform Electron desktop app that drives the Claude Agent SDK from a
GUI, replacing the terminal `claude` workflow. End goal: Jira → worktree →
agent team → PR → merged, all from the app. Shipped so far (V0–V3 + V2.1 + V6
partial): live sessions, worktrees, roles, agencies with `send_message`,
monitor grid, GitHub PR views, project registry with focus model,
SQLite/Drizzle persistence.

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
apps/desktop/src/preload/   contextBridge — exposes typed `window.agentkeeper`
apps/desktop/src/renderer/  Vue app (views, components, composables, stores)
apps/desktop/src/shared/    IPC contract types — pure, no runtime imports
packages/core/              Session engine / Role-Agency engine (stub so far)
packages/sdk/               @agentkeeper/sdk — plugin contract (types-only)
packages/plugin-github/     GitHub plugin (shipped V6)
packages/plugin-*/          Future bundled plugins (V5: Jira)
```

**Plugin wall:** plugins import ONLY from `@agentkeeper/sdk`, never from
core. That boundary is enforced by convention now, by the loader later.

## Vocabulary

- **WorkItem** — external unit of work (Jira issue, GitHub issue, manual)
- **Job** — one Role + one Worktree + one Session, optionally linked to a WorkItem
- **Role** — reusable agent config; markdown file with YAML frontmatter
- **Agency** — named bundle of Roles with a routing topology

Roles live at `.agentkeeper/roles/<id>.md` (project) or
`~/.agentkeeper/roles/<id>.md` (global). Agencies at
`.agentkeeper/agencies/<id>.md`. Project scope wins on id collision.

## Vertical slices

- V0 ✅ monorepo + Electron/Vue shell
- V1 ✅ read-only session viewer (reads `~/.claude/projects/**/*.jsonl`)
- V2 ✅ live sessions via Agent SDK — 🎯 dogfood point
- V2.1 ✅ SQLite/Drizzle persistence — all session, cost, stats, draft, project, and
  agency-handoff data written to a local DB; legacy JSON auto-imported on first launch;
  sessions UI redesigned with select mode + bulk delete
- V3 ✅ multi-session + worktrees + roles + agencies + monitor grid
- V4 ✅ skills + commands manager (wraps `npx skills`)
  - ✅ Skills: list, install, remove, preview — project + global scope
  - ✅ Commands: list, create, edit, delete — project + global scope
  - ✅ Full backend (skills.ts, commands.ts), IPC, preload, modal UI
  - ✅ Modal-based UI accessible from ProjectHome header (intentional — no sidebar route)
- V5 🔄 Jira plugin (wraps user's `jira` CLI, Jira Cloud)
  - ✅ Plugin package (`packages/plugin-jira`) — CLI wrapping, WorkItemSource, activation lifecycle
  - ✅ IPC handlers — workItems list/get/transition/updateStatus, plugin config get/set
  - ✅ Preload bridge — workItems + plugins config APIs
  - ✅ Modal UI — JiraPanel, JiraIssueDetail, JiraSettingsModal; accessible from ProjectHome
  - ⬜ Routed page — add `/jira` route + JiraLayout to match GitHub pattern; migrate
    JiraPanel content out of ProjectHome modal into a global sidebar-accessible view;
    wire focused project filter. Sidebar `/jira` entry currently 404s until this lands.
- V6 🔄 GitHub plugin (PRs via `gh` CLI)
  - ✅ Phase 0 — sidebar shell + plugin nav registry
  - ✅ Phase 1+2 — GitHub settings, plugin health banner, GitHub routes
  - ✅ Phase 3 — PR list, detail views, and review form
  - ✅ Multi-repo config — `GitHubConfig.repos[]`, fan-out `listPRs`, per-repo
    filter dropdown, `?repo=` query param on PR detail routes
  - ✅ Project registry + focus model — `recentProjectsStore` extended with
    `repo` (auto-detected from `.git/config`) and `focusedProjectPath`;
    `useProjectsStore` Pinia store; sidebar project panel with focus toggle;
    `ProjectPicker` dialog (pre-populated, always shown, never skipped);
    `NewSessionModal` project field; GitHub filter + skills list react to
    focused project; adding a project auto-registers its GitHub repo
  - ⬜ Sessions view — migrate to global list (all projects); focused project
    acts as filter; "New session" picker already done
  - ⬜ Monitor view — wire focused project filter
  - ⬜ Project-as-filter plumbing for V5 Jira views when built


## Commands

```
pnpm dev          # start electron-vite dev server
pnpm typecheck    # vue-tsc --noEmit across all workspaces
pnpm build        # full production build
```

All three commands run from the repo root and operate on the full monorepo.
Typecheck and build before every commit.

## IPC data-flow pattern

Every new feature that spans main ↔ renderer follows this four-file path:

1. **`apps/desktop/src/shared/ipc-contract.ts`** — add the method signature to the `AgentKeeperAPI` type and the channel constant to `IPC_CHANNELS`.
2. **`apps/desktop/src/main/ipc.ts`** — register an `ipcMain.handle` for the new channel.
3. **`apps/desktop/src/preload/index.ts`** — expose it through `contextBridge.exposeInMainWorld` so the renderer sees `window.agentkeeper.<namespace>.<method>`.
4. **Renderer** — call `window.agentkeeper.<namespace>.<method>()` from a composable or Vue component.

Never import from `main/` or `preload/` in the renderer, and never import from `renderer/` in main. The shared types package (`src/shared/`) is the only cross-boundary import.

## Vue Query conventions

All async renderer data goes through `@tanstack/vue-query`. The canonical key registry is `apps/desktop/src/renderer/src/lib/queryKeys.ts` — add new key families there. Composables in `src/renderer/src/composables/` wrap `useQuery`/`useMutation` and are the right layer for data-fetching logic; views should consume composables rather than call `window.agentkeeper` directly.

## Router

`apps/desktop/src/renderer/src/router/index.ts` — uses `createWebHashHistory`. Add new top-level routes there. Plugin layout routes follow the pattern in `/jira` and `/github` (nested children under a Layout component).

## Plugin settings architecture

Plugins activate in the main process (Node.js) and cannot contribute Vue components across the IPC boundary, so the `settingsPanels` UISlot in the SDK is structurally dormant. Plugin settings UI is implemented as renderer-side panel components registered in a static `pluginSettingsPanels` registry; `SettingsView.vue` renders a tab per registered panel. Adding a new bundled plugin: create a `<Plugin>SettingsPanel.vue` and add an entry to the registry.

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

Inter-agent messaging via `mcp__agentkeeper__send_message(to, content)`.
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

- Don't push or force-push without explicit instruction.
- Don't edit from the `planner` role — it's tool-restricted for a reason.
- Don't reach into `packages/core` from a plugin. Only `@agentkeeper/sdk`.
- Don't write comments that describe WHAT code does — only non-obvious
  WHY. No file-level docstrings.
- Don't add backwards-compat shims for code that isn't shipped yet.
