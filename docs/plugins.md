# Plugin authoring and distribution

AgentKeeper plugins are separately installed packages. A clean desktop installation
contains the plugin host but no provider integrations; the official GitHub and Jira
plugins are built and published as `.akp` artifacts by the release pipeline.

## Package structure

Every plugin has a `manifest.json`, a package metadata file, and self-contained build
outputs. The manifest names the Node entry point and, when the plugin has a UI, its
browser renderer:

```text
manifest.json
package.json
dist/index.js
dist/renderer.js
```

Backend output must not depend on workspace packages or undeclared files outside the
archive. Renderer output is a browser bundle loaded in a sandboxed iframe. The packer
rejects entry paths that escape the plugin directory or refer to files that are not
included in the archive.

The built-in examples live in `plugins/github` and `plugins/jira`. They import the
host contract only from `@agentkeeper/sdk`; plugins must never import desktop or core
implementation files.

Plugin backends run in a hidden, sandboxed Chromium renderer and Web Worker with Node
integration disabled. They receive capabilities through a narrow host protocol and
have no direct Node.js or filesystem API. Persistent data must use `ctx.storage`,
credentials must use `ctx.secrets`, and project discovery must use `ctx.projects`.
Network access is granted only to plugins declaring `network` and is routed through
the host's allowlisting broker.

Plugins may request selected host environment variables by declaring the
`environment` permission and listing exact uppercase variable names in
`environment.variables`. They read those values through `ctx.environment.get(name)`;
the values are never copied into the plugin process environment, and undeclared names
are rejected by the host. Plugin settings may override a retrieved value locally
without changing the host environment.

Subprocess creation, worker threads, and native addons are denied by default. A
plugin that genuinely needs to execute local programs must declare `nativeProcess`;
this grants arbitrary user-level process execution and is shown as a high-risk
permission during install. Programs launched under that permission execute with the
user's filesystem access, so `nativeProcess` subsumes filesystem isolation in
practice.

See [Plugin trust and isolation](plugins/security.md) for the supported installation
sources, permission lifecycle, update integrity checks, renderer guarantees, and the
limits of the current isolation model.

## Commands

From the repository root:

```bash
pnpm build:plugins
pnpm typecheck:plugins
pnpm verify:plugin-packages
pnpm pack:plugins
```

`pack:plugins` produces a versioned `.akp` beside each plugin. These archives are
ignored by Git. To package one plugin directly, build the CLI and run:

```bash
pnpm --filter @agentkeeper/cli build
pnpm --filter @agentkeeper/cli exec node dist/cli.cjs pack --dir ../../plugins/github
```

During development, open Plugins and choose **Load unpacked**. To test the distributable
artifact, choose **Install from AKP** and select the generated archive. Installation
shows the permissions requested by the manifest before activation.

## Manifest-owned UI

Provider navigation, routes, and settings are manifest contributions. A renderer
registers the view IDs named by `renderer.views`; the desktop maps them through the
generic plugin route. Provider-specific pages must not be added to the desktop router
or compiled as host Vue components.

The iframe receives `window.agentkeeperPlugin`, which provides:

- `getRoute()` and `onRouteChanged()` for plugin-local routing
- `navigate(path)` for navigation within the plugin
- `invoke(command, args)` for commands registered by that plugin
- `openExternal(url)` for an explicit browser handoff
- `startSession(itemId, projectPath?)` to ask the host to compose a session for a
  work item owned by the plugin
- `getWorkItemSessions(itemId?)` for provider-scoped session history
- `openSession(sessionId)` to navigate to a validated provider-owned session

The host owns session creation, project/role/agency selection, worktrees, and session
navigation. Plugins supply only the work-item ID and an optional suggested registered
project. Session history is filtered by the plugin's registered work-item source so a
plugin cannot inspect another provider's sessions.

## Provider capabilities

The GitHub plugin uses the authenticated `gh` CLI and discovers repositories from
registered AgentKeeper projects. It includes PR filtering, detail and Markdown views,
checks, reviews, comments, merge actions, and session workflows. PR diff rendering is
not currently part of the plugin.

The Jira plugin uses the user's `jira` CLI. Its settings page accepts an optional CLI
path and maps Jira projects to registered AgentKeeper projects. It includes board
filtering and grouping, issue detail and Markdown views, transitions, comments, ticket
creation, and session workflows.

## Release pipeline

Release Please treats GitHub and Jira as independent release components. When a plugin
release is created, `.github/workflows/publish-plugin.yml` builds and packs it, uploads
the versioned `.akp` and update manifest to that release, and updates a stable feed
release. Each plugin's `update_url` points at its stable feed rather than at the desktop
release.

Before publishing a plugin change, run:

```bash
pnpm typecheck
pnpm -r test
pnpm build
pnpm verify:plugin-packages
pnpm pack:plugins
```

Keep plugin versions and release configuration aligned whenever the package format or
feed location changes.
