# Production releases

AgentKeeper ships signed macOS and Windows installers from GitHub Releases. A
release is only made public after both platforms build and their signatures are
verified.

## GitHub configuration

Create a GitHub Environment named `production-signing`. Restrict it to the
default branch and add required reviewers where the repository plan supports
them.

Environment secrets:

| Name | Value |
| --- | --- |
| `MAC_CSC_LINK` | Base64-encoded Developer ID Application `.p12` |
| `MAC_CSC_KEY_PASSWORD` | Password protecting the `.p12` |
| `MAC_APPLE_API_KEY` | Contents of the App Store Connect `.p8` key |
| `MAC_APPLE_API_KEY_ID` | App Store Connect API key ID |
| `MAC_APPLE_API_ISSUER` | App Store Connect issuer UUID |
| `WIN_CSC_LINK` | Base64-encoded Windows Authenticode `.pfx` |
| `WIN_CSC_KEY_PASSWORD` | Password protecting the `.pfx` |

Environment variable:

| Name | Value |
| --- | --- |
| `MAC_APPLE_TEAM_ID` | Ten-character Apple Developer team ID |

The workflow maps these platform-prefixed values onto the environment names
understood by Electron Builder. Certificates and private keys must never be
committed to the repository.

Production uses `apps/desktop/electron-builder.production.yml`; the base
configuration deliberately remains suitable for unsigned local packaging.

## Release flow

1. Merge conventional commits into `main`.
2. Release Please creates or updates its release pull request.
3. Review and merge that pull request.
4. Release Please creates the version tag and GitHub Release.
5. The production workflow immediately changes the release to a draft.
6. macOS builds DMG and ZIP artifacts for Intel and Apple Silicon, signs them,
   submits them to Apple for notarization, and validates the stapled ticket.
7. Windows builds the NSIS installer, signs it with Authenticode, and validates
   the resulting signature.
8. The pipeline gathers installers, update metadata, blockmaps, and SHA-256
   checksums, then publishes the draft as the latest release.

If either platform fails, the release remains a draft. Fix the problem and run
`Build Production Release` manually with the existing tag and tag ref.

## Update delivery

Electron Builder publishes these files with every release:

- `latest-mac.yml`, the macOS update manifest
- macOS ZIP files required by the updater
- `latest.yml`, the Windows update manifest
- the NSIS installer
- blockmaps used for differential downloads

Installed AgentKeeper builds contain `app-update.yml`, which points
`electron-updater` at the public `agentkeeper-ai/agentkeeper` GitHub Releases
feed. Draft and prerelease releases are not offered to stable clients.

The app checks once 30 seconds after startup without downloading anything.
Users can also open Settings and select **Check for updates**. When a version is
available, downloading and restarting are separate explicit actions so an
active agent session is never interrupted.

Update metadata and its referenced installer must always come from the same
build. Do not replace only an installer or only a `latest*.yml` file on an
existing release. Publish a higher version to recover from a broken release.

## Marketing and documentation deployment

The marketing/documentation site should be independently deployable from the
desktop release. Its CI job should build on changes to its own directory and
deploy immutable static output to the chosen host.

Download buttons should use GitHub as the canonical artifact source rather
than copying installers into the site deployment:

- General download page: `https://github.com/agentkeeper-ai/agentkeeper/releases/latest`
- Release data for platform-aware buttons:
  `https://api.github.com/repos/agentkeeper-ai/agentkeeper/releases/latest`

The site can read the release API at build time to render the current version,
release notes, and platform-specific asset URLs. Keeping binaries in GitHub
Releases ensures the website and in-app updater refer to the same signed bytes.

Before implementing the public site, decide its domain, hosting provider,
analytics/privacy requirements, documentation authoring format, and whether
release notes should be edited independently from the Release Please changelog.

## iOS TestFlight distribution

Pull requests and pushes run `.github/workflows/ios-ci.yml`, which compiles the
shared `AgentKeeperRemote` scheme for a generic iOS Simulator destination.
Code signing is disabled, so this check does not have access to Apple secrets.

Run **Publish iOS to TestFlight** manually to archive, export, and upload an iOS
Release build. The job uses the `production-signing` environment and requires
these organization variables:

| Name | Value |
| --- | --- |
| `APPLE_TEAM_ID` | Ten-character Apple Developer team ID |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer UUID |

The environment must provide one secret:

| Name | Value |
| --- | --- |
| `APPLE_API_KEY` | Complete contents of the App Store Connect `.p8` key |

The workflow writes the key to `RUNNER_TEMP`, uses authenticated automatic
signing and provisioning, assigns `${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}`
as the build number, exports an App Store Connect IPA, and uploads it. Apple
processes accepted uploads for TestFlight; selecting a tested build and
submitting it to App Review remains a manual App Store Connect operation.

The App Store Connect API key must have enough access to manage signing assets
and upload builds, and the app record and bundle ID `com.agentkeeper.remote`
must already exist. If automatic signing cannot provide a distribution identity
on a clean GitHub runner, install an Apple Distribution certificate/private key
and matching provisioning profile in the job rather than committing them.
