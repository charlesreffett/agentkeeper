# AgentKeeper

AgentKeeper is a cross-platform desktop app for running coding agents, managing
Git worktrees, and coordinating agent teams from one workspace. It supports
Claude Code, OpenCode, Codex, Cursor, and Grok through a shared harness interface.
Available models and features depend on the selected harness.

- Run live sessions with streaming output, tool activity, and session history.
- Organize projects and worktrees, configure reusable roles, and coordinate
  agencies with message routing and a monitor grid.
- Manage plans, skills, slash commands, and external MCP servers.
- Install the GitHub and Jira plugins for pull-request and issue workflows.
- Connect an iOS companion app to the desktop over the local network.

Session and application data are persisted locally with SQLite and Drizzle.

## Stack

- Electron + Vite + Vue 3 + TypeScript
- Tailwind + Shadcn-Vue
- pnpm workspaces
- Claude Agent SDK, OpenCode SDK, CLI adapters, and ACP adapters for agent execution
- Pinia for renderer state and TanStack Vue Query for server state
- SQLite + Drizzle for local persistence
- keytar for API-key storage in the OS keychain

## Prerequisites

- Node.js >= 24
- pnpm 11.20.0, pinned in `package.json`
- Git for project and worktree workflows
- The executable and authentication required by your chosen agent harness

Claude Code supports an existing authenticated account or an Anthropic Console
API key stored in the OS keychain. Other harnesses use their own authentication
flows. Configure authentication and executable overrides in **Settings → Models &
Harnesses**.

## Getting started

```bash
corepack enable   # enable package-manager shims
pnpm install      # install all workspace dependencies
pnpm dev          # start the Electron app in dev mode
```

After launch, add a local project and choose a harness and model for a new
session. Check **Settings → Models & Harnesses** if a harness is unavailable or
needs authentication.

GitHub and Jira integrations are separately installed `.akp` plugins; a clean
desktop installation includes the plugin host without these integrations. See
the [plugin guide](./docs/plugins.md) for installation and local development.

## Common commands

```bash
pnpm dev          # run the desktop app (electron-vite dev server)
pnpm typecheck    # type-check all workspace packages
pnpm build        # build packages, plugins, and the desktop app
pnpm --filter desktop test # run desktop tests
pnpm pack:plugins # build installable GitHub and Jira .akp packages
pnpm dist:mac     # build a macOS distributable
pnpm dist:win     # build a Windows distributable
```

Plugin validation commands:

```bash
pnpm verify:plugin-boundaries # check plugin imports and host boundaries
pnpm verify:plugin-packages   # build and validate plugin artifacts
pnpm verify:sdk-package       # build and validate the public SDK package
```

Run `pnpm typecheck` and `pnpm build` before every commit. For signed production
releases, previews, and updater configuration, see the
[release guide](./docs/releasing.md).

## Monorepo layout

```
apps/desktop/               Electron shell (main + preload + Vue renderer)
apps/desktop/src/main/      Node — agent driver, IPC, git worktrees, secrets
apps/desktop/src/preload/   contextBridge — exposes typed `window.agentkeeper`
apps/desktop/src/renderer/  Vue app (views, components, composables, stores)
apps/desktop/src/shared/    IPC contract types — pure, no runtime imports
apps/ios/                   iOS companion app (SwiftUI)
packages/core/              Shared harness abstraction and session/event types
packages/sdk/               @agentkeeper/sdk — plugin contracts and runtime/test helpers
packages/cli/               akp CLI for plugin development and packaging
packages/skills/            Bundled agent skills
plugins/github/             GitHub plugin (separately installed)
plugins/jira/               Jira plugin (separately installed)
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
Vue Query conventions, and the commit format. See the [plugin author and release
guide](./docs/plugins.md) for the plugin boundary, package format, renderer bridge,
and distribution workflow. Key rules:

- Plugins import only from `@agentkeeper/sdk`, never from `packages/core`.
- Cross-boundary code goes through `apps/desktop/src/shared/` only.
- Don't push or force-push without explicit instruction.

### Commit format

```
<type>(<scope>): <short imperative subject>

<body: what changed and why. Call out deferred work or known gaps.>
```

## iOS Companion

Enable remote access via **Settings → Remote** in the desktop app. Generate a
secret key and note the URL shown. Open `apps/ios/AgentKeeperRemote/AgentKeeperRemote.xcodeproj` in
Xcode, set your development team, then build and run on a device or simulator. Enter
the desktop URL + secret key on the iOS Setup screen to pair. Bundle ID:
`com.agentkeeper.remote`.
