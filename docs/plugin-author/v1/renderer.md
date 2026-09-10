# Renderer bridge and communication

The renderer entry is a self-contained browser bundle loaded in a sandboxed iframe.
It receives `<div id="app">` and `window.agentkeeperPlugin`. Dependencies, compiled
templates, and styles must be bundled or injected by the entry. Production code must
not require `eval`, runtime template compilation, Node.js, a CDN, or parent-DOM access.
The renderer entry limit is 5 MiB.

The bridge provides:

- `pluginId`, `viewId`, and `getRoute()`.
- `onRouteChanged(listener)` with an unsubscribe function.
- `navigate(path)` for a declared plugin-local route.
- `invoke(command, args)` for a command owned by this plugin.
- `openExternal(url)` for an explicit browser handoff.
- `startSession(itemId, projectPath?)` for this provider's work item.
- `getWorkItemSessions(itemId?)` for provider-scoped history.
- `openSession(sessionId)` for a validated provider-owned session.

The iframe CSP denies ambient network, frames, forms, objects, media, and top-level
navigation. Use backend commands for provider communication; the backend then uses
the network broker. The host validates message source, per-document token, command
ownership, route declarations, provider ownership, project registration, and session
ownership.

## Framework guidance

Vue, React, Svelte, vanilla TypeScript, and vanilla JavaScript are supportable when
their production output is one self-contained browser bundle. Framework source is
not loaded directly. Compile Vue templates and Svelte components ahead of time;
bundle React/Vue runtimes; inject or bundle CSS; avoid dynamic chunk URLs. Official
starter templates are not yet published, so the bundled GitHub and Jira plugins are
the current working examples.

## Robust rendering

Treat route params and command results as untrusted. Render text with DOM text APIs or
framework escaping. Increment a render-generation counter before asynchronous loads
and discard results from an older generation after navigation. Show explicit loading,
empty, error, and provider-unavailable states. Unsubscribe from route changes during
teardown.

Use semantic headings and landmarks, label every control, retain visible focus, keep
keyboard order logical, announce async status, honor reduced motion, and preserve
contrast in light and dark themes. Never communicate state through color alone.
