# AgentKeeper

Cross-platform Electron desktop app that drives the Claude Agent SDK from a GUI,
replacing the terminal `claude` workflow. End goal: Jira → worktree → agent team →
PR → merged, all from the app.

Shipped so far: live sessions, worktrees, roles, agencies with `send_message`,
monitor grid, GitHub PR views, project registry with focus model, and
SQLite/Drizzle persistence. An iOS companion app pairs with the desktop over the
local network.

## Stack

- Electron + Vite + Vue 3 + TypeScript
- Tailwind + Shadcn-Vue
- pnpm workspaces
- `@anthropic-ai/claude-agent-sdk` (spawns a bundled `claude` subprocess)
- Pinia for renderer state
- keytar for API-key storage in the OS keychain

## Prerequisites

- Node.js >= 20
- pnpm 9 (`corepack enable` will provide the pinned version)
- Authentication, one of:
  - A Claude Pro/Max plan via an existing `claude login`, or
  - An Anthropic Console API key (stored in the OS keychain, never in env)

## Getting started

```bash
pnpm install      # install all workspace dependencies
pnpm dev          # start the Electron app in dev mode
```

## Common commands

```bash
pnpm dev          # run the desktop app (electron-vite dev server)
pnpm typecheck    # vue-tsc --noEmit across all workspaces
pnpm build        # full production build
pnpm dist:mac     # build a macOS distributable
pnpm dist:win     # build a Windows distributable
```

Run `pnpm typecheck` and `pnpm build` before every commit.

## Monorepo layout

```
apps/desktop/               Electron shell (main + preload + Vue renderer)
apps/desktop/src/main/      Node — agent driver, IPC, git worktrees, secrets
apps/desktop/src/preload/   contextBridge — exposes typed `window.agentkeeper`
apps/desktop/src/renderer/  Vue app (views, components, composables, stores)
apps/desktop/src/shared/    IPC contract types — pure, no runtime imports
apps/ios/                   iOS companion app (SwiftUI)
packages/core/              Session engine / Role-Agency engine
packages/sdk/               @agentkeeper/sdk — plugin contract (types-only)
packages/plugin-github/     GitHub plugin (PRs via `gh` CLI)
packages/plugin-jira/       Jira plugin (wraps the `jira` CLI)
```

## Vocabulary

- **WorkItem** — external unit of work (Jira issue, GitHub issue, manual)
- **Job** — one Role + one Worktree + one Session, optionally linked to a WorkItem
- **Role** — reusable agent config; markdown file with YAML frontmatter
- **Agency** — named bundle of Roles with a routing topology

Roles live at `.agentkeeper/roles/<id>.md` (project) or `~/.agentkeeper/roles/<id>.md`
(global). Agencies at `.agentkeeper/agencies/<id>.md`. Project scope wins on id collision.

## Contributing

See [CLAUDE.md](./CLAUDE.md) for architecture details, the IPC data-flow pattern,
Vue Query conventions, the plugin boundary rules, and the commit format. Key rules:

- Plugins import only from `@agentkeeper/sdk`, never from `packages/core`.
- Cross-boundary code goes through `apps/desktop/src/shared/` only.
- Don't push or force-push without explicit instruction.

### Commit format

```
<scope>: <short imperative subject>

<body: what changed and why. Call out deferred work or known gaps.>
```

## iOS Companion

Enable via Settings → Mobile tab in the desktop app. Set a secret key and note the
URL shown. Open `apps/ios/AgentKeeperRemote/AgentKeeperRemote.xcodeproj` in
Xcode, set your development team, then build and run on a device or simulator. Enter
the desktop URL + secret key on the iOS Setup screen to pair. Bundle ID:
`com.agentkeeper.remote`.
