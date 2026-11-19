# Renderer bridge and communication

The renderer entry is a self-contained browser bundle loaded in a sandboxed iframe.
It receives `<div id="app">` and `window.agentkeeperPlugin`. Dependencies, compiled
templates, and styles must be bundled or injected by the entry. Production code must
not require `eval`, runtime template compilation, Node.js, a CDN, or parent-DOM access.
The renderer entry limit is 5 MiB.

The bridge provides:

- `pluginId`, `viewId`, and `getRoute()`.
- `onRouteChanged(listener)` with an unsubscribe function.
- `getTheme()` and `onThemeChanged(listener)` returning a `PluginRendererTheme`
  (`{ variant, tokens }`).
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

## Theming

The host sets its theme as CSS custom properties on the iframe's `<html>` before
the renderer runs and updates them live when the user changes theme or switches
between light and dark. `<html>` also carries the `dark` class and a matching
`color-scheme`. Style against the tokens instead of fixed colors, with a fallback
for hosts that predate theming:

```css
body { background: var(--background, Canvas); color: var(--foreground, CanvasText); }
.badge { color: var(--brand, #3b82f6); }
```

Available tokens: `--background`, `--foreground`, `--card`, `--card-foreground`,
`--popover`, `--popover-foreground`, `--muted`, `--muted-foreground`, `--accent`
(hover surface), `--accent-foreground`, `--brand` and `--brand-foreground` (the
user's accent color), `--primary`, `--primary-foreground`, `--secondary`,
`--secondary-foreground`, `--border`, `--input`, `--ring`, `--success`, `--warning`,
`--info`, `--destructive`, `--highlight` (each with a `-foreground` for text on a
solid fill), `--diff-added`, `--diff-removed`, `--code-background`,
`--code-foreground`, `--code-font-size`, `--font-sans`, `--font-mono`,
`--shadow-popover`, and `--shadow-dialog`. Status
colors meet 4.5:1 contrast against `--background`. Use `onThemeChanged` only for
output that can't read CSS variables, such as canvas drawing.

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
