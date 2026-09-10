# AgentKeeper plugin author guide — contract v1

This documentation describes plugin manifest schema version `1` and the public
`@agentkeeper/sdk` contract shipped with AgentKeeper. A plugin is a separately built
package with a sandboxed backend and, optionally, a self-contained browser renderer.

## Guides

- [Build your first plugin](tutorial.md)
- [Manifest reference](manifest.md)
- [SDK and host APIs](sdk.md)
- [Renderer bridge and communication](renderer.md)
- [Security, testing, and distribution](operations.md)
- [Support matrix and troubleshooting](support.md)

The host owns installation, permission consent, process supervision, project and
session state, application navigation, and external URL handling. A plugin owns its
provider protocol, settings interpretation, provider-specific work-item IDs, command
handlers, and renderer content.

The backend runs in a dedicated Chromium sandbox and Web Worker with Node integration
disabled. Host capabilities are brokered through the activation context. The renderer
runs in a sandboxed iframe with an opaque origin and uses
`window.agentkeeperPlugin`; it cannot access the parent DOM.

## Versioning policy

This `v1` directory is tied to manifest schema version 1. Additive clarifications and
optional fields may update these pages in place. Breaking manifest, protocol, SDK, or
renderer-bridge changes require a new versioned directory, a migration guide, and a
changelog entry. Published SDK versions use semantic versioning. Plugins declare the
minimum compatible application through `min_app_version`.
