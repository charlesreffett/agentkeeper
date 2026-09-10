# Support matrix and troubleshooting

## Public support matrix

| Area | v1 status |
| --- | --- |
| Manifest schema | Version 1, strict validation |
| Backend | Self-contained ESM bundle in Chromium Web Worker sandbox |
| Renderer | Optional self-contained browser bundle, maximum 5 MiB |
| UI frameworks | Vue, React, Svelte, vanilla TS/JS build outputs supported; official starters pending |
| Operating systems | macOS, Windows, Linux where the desktop application is supported |
| Compatibility | Semantic plugin version plus `min_app_version` |
| UI contributions | Manifest routes, primary navigation, Settings pages |
| Providers | Work-item provider registry; provider-owned opaque IDs |
| Examples | Bundled GitHub and Jira plugins; headless and framework-specific examples pending |
| Renderer limitations | No ambient network, Node, parent DOM, runtime CDN, popups, or top navigation |
| Distribution trust | HTTPS and SHA-256 integrity; publisher signatures/provenance pending |

## Diagnostics

**Activation fails:** validate `entry`, build the bundle, check `min_app_version`,
review action-required authority, and inspect backend logs.

**View unavailable:** confirm `ui`, renderer entry, declared view, route-to-view mapping,
enabled state, and bundle size. Check CSP errors for dynamic chunks, external assets,
inline evaluation, or runtime template compilation.

**Permission denied:** add only the required manifest permission and exact authority,
then repeat review. Settings cannot grant undeclared authority.

**Provider not available:** verify the provider plugin is installed, enabled, active,
authenticated, healthy, and owns the persisted `sourceId`. Keep showing the offline
snapshot; do not guess from `externalRef`.

**Command fails:** validate structured-clone-safe input, plugin command ownership,
registration lifetime, and public error messages. Check for a stale renderer request
after route change.

**Network fails:** verify the exact scheme, canonical host, port, redirect targets,
request/response size, timeout, and `network` grant. Renderer fetch is intentionally
blocked.

**Update fails:** verify HTTPS feed and archive URLs, identity, semantic version,
SHA-256, minimum app version, package entries, and authority expansion. Retain the old
release while investigating rollback logs.

**Unpacked reload stops:** the manifest authority changed. Reopen the review flow and
accept the native confirmation; watcher reload cannot approve new authority.
