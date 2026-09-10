# Security, testing, and distribution

## Security checklist

- Request least privilege and exact network origins.
- Store credentials only in `ctx.secrets`; never send them to the renderer or logs.
- Treat repository files, provider responses, settings, routes, and command arguments
  as untrusted.
- Prefer brokered APIs. `nativeProcess` executes with user authority and defeats the
  normal filesystem/process boundary.
- Use HTTPS, audit dependencies, bundle deterministically, and publish checksums and
  provenance when available.
- Use `openExternal` only after an explicit user action and never include credentials
  in the URL.

## Test layers

1. Unit-test provider mapping, validation, error normalization, and command handlers.
2. Use `@agentkeeper/sdk/testing` for activation-context and registration tests.
3. Test renderer loading, navigation generations, unavailable states, keyboard use,
   accessible names, focus, and both themes.
4. Validate the manifest and package paths with the AgentKeeper CLI.
5. Run host-contract fixtures for permission denial, ownership isolation, structured
   serialization, lifecycle cleanup, and compatibility.
6. Smoke-test unpacked development loading, an installed `.akp`, update, rollback,
   disable, restart, and uninstall on every supported operating system.

## Archive and release contract

An `.akp` is a bounded archive containing `manifest.json`, package metadata, backend
output, optional renderer output, and assets referenced by the manifest. It must not
contain path traversal, symlink escapes, missing entries, or runtime workspace
dependencies. The host bounds archive size, expanded size, entry count, compression
ratio, backend size, and renderer size.

An update feed uses HTTPS and identifies the plugin plus releases containing version,
archive URL, SHA-256, optional minimum app version, notes, and channel-specific feed
location. Versions follow semantic versioning. The host validates identity, checksum,
compatibility, and authority expansion before activation and attempts rollback after
an activation failure.

Checksums do not prove publisher identity because update manifests are not currently
signed. Distributors should retain immutable releases and provenance. Do not reuse a
version for different bytes. Keep a previous compatible archive available for
rollback and document deprecations before removing fields or behaviors.

## Changelog and migration policy

Every release should list added permissions, network origins, environment names,
manifest changes, SDK/bridge changes, storage migrations, minimum app changes, and
user-visible behavior. Breaking changes require a major plugin version and a tested
upgrade path. Stored data migrations must be forward-only, idempotent, and tolerant of
interrupted activation. Never silently reinterpret ambiguous provider IDs.
