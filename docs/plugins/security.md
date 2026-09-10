# Plugin trust and isolation

This document describes the security boundary implemented by AgentKeeper's plugin
host. It is a statement of the current guarantees and limitations, not a claim that
third-party plugin code is safe.

## Trust and installation sources

AgentKeeper distinguishes plugin inputs by source, not by an inferred reputation
score:

| Source | Intended trust | Installation behavior |
| --- | --- | --- |
| Bundled | Shipped with the application | Registered by the application and cannot be uninstalled as a user package. |
| AKP archive | User-selected package | The archive is staged and validated, then a native confirmation displays the exact plugin and requested authority before installation. |
| Update manifest | Publisher-selected package over HTTPS | The manifest and archive identity are checked, the archive SHA-256 must match, and authority expansion prevents silent activation. |
| Unpacked development directory | Mutable local development input | Supported only by development builds today. Files can change after review and must not be treated as a signed release. |

AgentKeeper does not currently establish publisher identity or cryptographically sign
plugins. An HTTPS URL and matching checksum protect transport and package integrity;
they do not prove who authored a package. Users must trust the package source and
review the displayed authority.

## Permission review and revocation

The manifest declares all plugin permissions. Network origins and environment
variable names are part of the authority grant, not unreviewed settings. The host
normalizes and persists the approved authority for the installed plugin.

Installation uses a prepare, review, and native-confirm flow. Enabling a plugin also
checks its current manifest against the persisted grant. An update or unpacked-file
reload that requests additional permissions, network origins, or environment
variables is stopped and marked as requiring action; it does not inherit broader
authority automatically.

Disabling or uninstalling a plugin stops its backend and revokes its live host
capabilities. Uninstalling removes the installed package and plugin-owned host data;
it cannot undo external side effects already performed by a granted network request
or native process. Secrets remain isolated by plugin ID and are not exposed to other
plugins.

`nativeProcess` is a high-risk permission. A granted executable runs with the user's
operating-system authority and can access resources outside the normal plugin
sandbox. Only install such plugins when their entire package and dependencies are
trusted.

## Backend isolation

Each active backend is placed in a dedicated, non-persistent Chromium partition and
hidden `BrowserWindow`. Chromium sandboxing and context isolation are enabled; Node
integration and `<webview>` are disabled. The backend executes in a Web Worker. The
container rejects navigation, new windows, media, device permissions, and direct
network requests. Its content security policy permits only the data and blob scripts
needed to bootstrap the worker.

Host features are available only through the typed plugin protocol. The host checks
the plugin's persisted grant again at broker boundaries. Storage and secrets are
namespaced to the plugin. Network requests are made by the host broker, which checks
the exact declared origin for the initial URL and every redirect. Environment values
are returned only for explicitly declared names and are not copied into the plugin
process environment.

These controls reduce accidental and malicious reach, but they are not a substitute
for operating-system process or account isolation. Chromium vulnerabilities, host
broker bugs, a deliberately broad grant, and `nativeProcess` can cross the intended
boundary. Resource quotas mitigate some abuse; they do not guarantee that a hostile
plugin cannot consume CPU or memory.

## Application UI isolation

A plugin UI is a self-contained browser bundle loaded into a sandboxed iframe with an
opaque origin. The iframe has scripts enabled but no same-origin privilege, forms,
popups, top navigation, downloads, or direct network access. A per-document random
token and source checks authenticate `postMessage` traffic. The bridge exposes only
declared navigation, provider-scoped command invocation, external-link handoff, and
session operations. Plugin routes are resolved from validated manifest contributions.

The current iframe runs in the application's renderer process. The iframe boundary
provides DOM-origin and capability isolation, but not process isolation: a renderer
engine exploit or sustained CPU/memory abuse can affect the host renderer. AgentKeeper
therefore treats the present UI boundary as suitable for reviewed plugins with narrow
authority, not as a complete containment boundary for arbitrary hostile code.

### Why an iframe today

| Model | UI integration | Isolation | Main tradeoffs |
| --- | --- | --- | --- |
| Sandboxed iframe (current) | Strong theming, sizing, focus, and accessibility integration | Origin/capability isolation in the host renderer process | Lowest overhead and easiest debugging; shares renderer availability and resource pressure. |
| Electron `<webview>` | Separate guest contents | Stronger renderer separation | Larger IPC and navigation surface, more complex focus/accessibility/theming, and intentionally disabled by the current host. |
| Separate `BrowserView`/window process | Separate renderer lifecycle | Stronger failure and resource isolation | Harder layout, clipping, focus, accessibility tree, theme synchronization, and developer tooling integration. |
| Out-of-process native service plus declarative UI | Strongest backend separation and host-controlled rendering | No arbitrary plugin DOM in the app renderer | Narrowest UI capability and highest contract/design cost. |

Before accepting unreviewed third-party UI, the project should move arbitrary renderer
code to a separately supervised renderer process or replace it with host-rendered,
declarative contributions. That decision must preserve keyboard navigation,
screen-reader relationships, color/theme updates, predictable focus, crash recovery,
resource limits, debuggability, and a smaller—not broader—IPC surface.

## Update integrity and recovery

Update URLs must use HTTPS. Release entries identify the plugin, version, minimum app
version, archive URL, and SHA-256. The host refuses redirects during manifest fetch,
validates manifest/package identity and semantic-version progression, verifies the
archive checksum, stages the new package, and rolls back activation when an update
fails. An authority expansion leaves the plugin disabled until reviewed.

Checksums detect corruption or substitution relative to the update manifest, but the
manifest is not signed. A compromised publisher endpoint can replace both values.
Release infrastructure should add signed provenance before the ecosystem is treated
as an open public marketplace.

## Security expectations for authors

- Request the smallest permission set and the narrowest exact network origins.
- Keep credentials in `ctx.secrets`; never place them in settings, logs, renderer
  messages, URLs, or plugin storage.
- Treat provider responses, repository content, settings, and route parameters as
  untrusted data.
- Bundle dependencies and audit the resulting artifact. Runtime code download and
  evaluation are outside the supported contract.
- Use `openExternal` for explicit user-directed browser navigation. Do not construct
  hidden redirects or credential-bearing external URLs.
- Clean up event subscriptions and background work on deactivation.
- Avoid `nativeProcess` unless the integration cannot be expressed through narrower
  host capabilities.

Report a suspected boundary bypass as a security issue rather than publishing a
working exploit in a public bug report.
