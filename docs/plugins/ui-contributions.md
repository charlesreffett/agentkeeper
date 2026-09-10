# Plugin UI contribution contract

AgentKeeper plugins extend application navigation through declarative manifest
contributions. This document records the public contract and the design evidence
behind it.

## Decision

The manifest is the source of truth for application UI structure:

- `renderer.entry` identifies one self-contained browser bundle.
- `renderer.views` lists the view IDs that bundle can render.
- `contributes.routes` maps plugin-local paths to declared views.
- `contributes.navigation` places declared routes in primary navigation.
- `contributes.settings` places declared routes in the Settings shell.

All resulting URLs remain under `/plugin/<plugin-id>/*`. Settings contributions use
`/plugin/<plugin-id>/settings/*`; the host chooses the Settings shell based on that
reserved segment. A plugin cannot register a core route or choose a route outside its
own namespace.

The host validates contributions before activation, owns their ordering and visual
container, and removes them when the plugin is disabled, uninstalled, or unhealthy.
The plugin owns only the content inside its declared renderer view. It cannot replace
the application sidebar, Settings shell, headers, or core pages.

Runtime `ctx.ui.contribute` registrations are lifecycle-scoped supplemental data.
They are not a second route-registration mechanism and must not create navigation or
settings URLs. New host slots require an explicit typed contract and host consumer
before they are considered supported.

## Why declarative contributions

VS Code separates declarative contribution points from extension runtime code. Its
manifest registers commands, views, view containers, configuration, and other
workbench placements; the host decides where and when they appear. Extensions run in
an extension host so extension work does not execute directly in the workbench UI.
Custom HTML is reserved for webviews, which are expected to use minimal capabilities,
restrict local resources, define a content security policy, and sanitize untrusted
input.

AgentKeeper adopts the same useful boundaries at a smaller scale:

| Concern | VS Code model | AgentKeeper contract |
| --- | --- | --- |
| Discoverability | Manifest `contributes` points | Manifest routes, navigation, and settings |
| Namespace ownership | Host-known view and command IDs | `/plugin/<plugin-id>/*` and plugin-scoped commands |
| Host layout | Workbench owns containers and placement | App and Settings shells own placement and ordering |
| Arbitrary UI | Webview/WebviewView | Sandboxed plugin iframe |
| Runtime isolation | Local, web, or remote extension host | Sandboxed backend renderer/worker and brokered host APIs |
| Activation | Contribution-aware activation events | Validated activation events and plugin lifecycle |

A contribution declaration does not grant authority by itself. UI placement must not
imply filesystem, network, secret, or process access. Arbitrary renderer code remains
behind the iframe bridge, and backend authority remains controlled by permissions and
brokers.

## Route and navigation rules

1. Route paths are plugin-local, relative, and validated by the manifest schema.
2. Navigation and Settings entries may reference only a declared route.
3. A declared route may render only a view listed by `renderer.views`.
4. Renderer or contribution declarations require the `ui` permission.
5. The host prefixes every route with the encoded plugin ID.
6. `settings` is reserved as the first plugin-local segment for Settings-shell pages.
7. The host rejects or ignores unknown icons rather than accepting executable markup.
8. Disabling or losing the plugin revokes the active document and presents one
   provider-unavailable state.

Plugin-local navigation uses `window.agentkeeperPlugin.navigate(path)`. The host
resolves the requested path against the validated manifest before changing the URL.
External URLs use `openExternal` and are never treated as internal routes.

## Accessibility and theming

The host owns accessible names, selection state, focus text, ordering, and keyboard
behavior for navigation entries. Plugin labels should be short and unique. Renderer
views must provide their own semantic landmarks, labels, focus order, visible focus,
reduced-motion behavior, and status announcements.

The bridge supplies the current color scheme and the host provides baseline system
font and foreground/background colors. Plugin bundles must respond to theme changes
without assuming access to the parent DOM. They must not communicate meaning through
color alone.

## Compatibility policy

Adding optional manifest contribution fields is backward compatible. Renaming a
contribution, changing route semantics, expanding accepted path syntax, or changing
the iframe bridge is a public contract change and requires SDK documentation,
compatibility tests, and a migration note. Experimental runtime slots remain outside
the stable route contract until they have typed payloads, production consumers, and
lifecycle/accessibility tests.

## References

- [VS Code contribution points](https://code.visualstudio.com/api/references/contribution-points)
- [VS Code extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)
- [VS Code webview security](https://code.visualstudio.com/api/extension-guides/webview#_security)
- [VS Code webview UX guidance](https://code.visualstudio.com/api/ux-guidelines/webviews)
