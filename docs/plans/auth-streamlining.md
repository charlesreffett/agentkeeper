# Auth Streamlining Plan

Remove hard dependencies on `claude`, `gh`, and `jira` CLI tools so users can
go from app install to fully working without any prerequisite setup steps.

---

## Context

Right now three external CLIs must be pre-installed and pre-authenticated:

| Tool | Used for | Auth method |
|------|----------|-------------|
| `claude` | Agent sessions (subprocess via Agent SDK) | `claude login` OAuth OR `ANTHROPIC_API_KEY` |
| `gh` | PR list / detail / review / merge | `gh auth login` |
| `jira` | Issue list / detail / transition | `jira auth` |

As of Feb 2026, Anthropic also clarified that the Agent SDK requires API key
authentication — OAuth tokens from Pro/Max `claude login` can no longer be
used with the SDK. Agent SDK Credits for subscription users land June 15 2026
but the auth mechanism remains API key.

---

## Phase 0 — Verify SDK Binary Bundling (½ day)

The TypeScript Agent SDK docs indicate it ships a native Claude Code binary as
an optional npm dependency. Confirm this before planning the Claude work.

**Tasks**
- [ ] Inspect `node_modules/@anthropic-ai/claude-agent-sdk/` for a bundled
      `claude` binary (look for `bin/`, `dist/`, or platform-specific packages)
- [ ] If present: confirm the Electron packager (`electron-vite` / `electron-builder`)
      includes optional dependencies by default; if not, add `asar.unpack` glob
      for the binary
- [ ] Update `agent.ts` `resolveClaudeAuth()` path resolution so that when no
      system `claude` is in PATH, it falls back to the SDK-bundled binary path
      (`require.resolve('@anthropic-ai/claude-agent-sdk/...')`)
- [ ] Log a clear error to the renderer if neither is available rather than
      silently failing

**Outcome**: Agent sessions work without `claude` installed separately.

---

## Phase 1 — First-Run Setup Wizard (1 day)

Replace the current silent "assume everything is configured" startup with an
explicit first-run check that surfaces what's missing and guides the user
through it.

**Tasks**
- [ ] Add `setupState` IPC channel: main checks each auth prerequisite and
      returns a structured status object:
      ```ts
      {
        claude: { ready: boolean; mode: 'apiKey' | 'bundled' | 'missing' }
        github: { ready: boolean; mode: 'oauth' | 'missing' }
        jira:   { ready: boolean; mode: 'apiToken' | 'missing' }
      }
      ```
- [ ] Create `SetupWizard.vue` — shown on first launch (or when `setupState`
      has any `ready: false`). Step-per-service: each step shows status and
      a simple action (enter API key, Connect GitHub, Add Jira token)
- [ ] Store a `setupComplete` flag in the app's user-data JSON so the wizard
      is skipped on subsequent launches unless the user revisits Settings
- [ ] Add a "Setup / Connection status" item to the Settings view that re-runs
      the check at any time

**Outcome**: Day-one user sees a clear setup flow instead of a broken app.

---

## Phase 2 — Claude: API Key as Sole Auth Path (½ day)

Since `claude login` OAuth is no longer valid for the Agent SDK, simplify the
auth resolution to API key only.

**Tasks**
- [ ] Remove the `claude login` subprocess fallback from `secrets.ts`
      `resolveClaudeAuth()` — API key path is now the only path
- [ ] Update the Settings panel to surface "Anthropic API Key" prominently with
      a direct link to `console.anthropic.com/settings/keys`
- [ ] If keytar returns no key, block session creation with an actionable error:
      "Add your Anthropic API key in Settings → Claude"
- [ ] Validate the key on entry (fire a minimal `models.list` call against the
      Anthropic SDK) and show a green/red status indicator

**Outcome**: Auth story for Claude is: paste key, done. No CLI needed.

---

## Phase 3 — GitHub: OAuth App + Octokit (2–3 days)

Replace `gh` CLI dependency with a registered GitHub OAuth App and direct
Octokit API calls.

### 3a — OAuth App registration & deep link (1 day)

- [ ] Register an Agentkeeper GitHub OAuth App at
      `github.com/settings/developers` (public client; PKCE; callback URL:
      `agentkeeper://oauth/github`)
- [ ] Register the `agentkeeper://` custom URL scheme in `electron-builder`
      config (`protocols` field) and handle it in `main/index.ts`
      (`app.setAsDefaultProtocolClient`)
- [ ] Implement PKCE helper in `main/auth.ts`:
      - Generate `code_verifier` + `code_challenge`
      - Open `https://github.com/login/oauth/authorize?client_id=...&code_challenge=...`
        via `shell.openExternal`
      - Receive the redirect on the custom scheme, extract `code`
      - Exchange `code` + `code_verifier` for an access token (no client
        secret needed with PKCE)
      - Store token in keytar under `plugin:github:access_token`
- [ ] Add `github.auth` IPC methods: `connect()`, `disconnect()`, `status()`
- [ ] Expose through preload and wire into `GitHubSettingsPanel.vue`

**SSO note**: The browser OAuth flow prompts for SAML SSO automatically for
any org that requires it. The resulting token is SSO-authorized. Orgs that
restrict third-party OAuth apps require a one-time admin approval of the
Agentkeeper app — surface a link to that approval page in the settings panel
if API calls return a 403 with `resource:application` in the header.

### 3b — Replace gh CLI calls with Octokit (1–2 days)

- [ ] Add `@octokit/rest` to `plugins/github`
- [ ] Rewrite `github-cli.ts` → `github-api.ts`; replace each `execFileAsync('gh', ...)`
      call with the equivalent Octokit method:

  | Current `gh` call | Octokit equivalent |
  |-------------------|--------------------|
  | `gh pr list` | `octokit.pulls.list()` |
  | `gh pr view` | `octokit.pulls.get()` |
  | `gh pr diff` | `octokit.pulls.get({ mediaType: { format: 'diff' } })` |
  | `gh api .../comments` | `octokit.issues.listComments()` |
  | `gh pr review` | `octokit.pulls.createReview()` |
  | `gh pr merge` | `octokit.pulls.merge()` |

- [ ] Remove health-check polling for `gh` binary; replace with a token
      presence check (`plugin.healthy` when keytar token exists)
- [ ] Update `plugins/github/src/index.ts` activation to read token from keytar
      and construct `Octokit({ auth: token })`

**Outcome**: GitHub works with zero CLI tools. SSO handled in browser.

---

## Phase 4 — Jira: API Token + REST (1–2 days)

Replace `jira` CLI dependency with direct Atlassian REST API calls using an
API token (Atlassian's recommended approach for desktop integrations).

### 4a — Settings UI for credentials (½ day)

- [ ] Extend Jira plugin KV store with three new fields:
      ```ts
      { email: string; apiToken: string; instanceUrl: string }
      ```
      `apiToken` stored in keytar (`plugin:jira:api_token`), not in the KV file
- [ ] Update `JiraSettingsModal.vue` to collect email + instance URL + API token
      with a direct link to `id.atlassian.net/manage/api-tokens`
- [ ] Add a "Test connection" button that fires a `GET /rest/api/3/myself`
      call and shows the authenticated user's name on success

**SSO note**: Atlassian API tokens are account-level credentials, not
session-bound. They work even for orgs with SSO enforced — the user generates
the token once while logged in via SSO and it works indefinitely (until
manually revoked). If an enterprise org has disabled API token creation, see
Phase 5 (OAuth 3LO).

### 4b — Replace jira CLI calls with REST (1 day)

- [ ] Add `node-fetch` or use the built-in `fetch` (Node 18+) in
      `plugins/jira`
- [ ] Write `jira-api.ts` with a typed Atlassian REST v3 client (base URL +
      Basic auth header `btoa(email:token)`)
- [ ] Rewrite `jira-cli.ts` → `jira-api.ts`; replace each `execFileAsync('jira', ...)`
      call:

  | Current `jira` call | REST equivalent |
  |---------------------|-----------------|
  | `jira project list` | `GET /rest/api/3/project/search` |
  | `jira issue list` | `GET /rest/api/3/search` (JQL) |
  | `jira issue view` | `GET /rest/api/3/issue/{id}` |
  | `jira issue create` | `POST /rest/api/3/issue` |
  | `jira issue move` | `POST /rest/api/3/issue/{id}/transitions` |
  | `jira issue comment add` | `POST /rest/api/3/issue/{id}/comment` |

- [ ] Remove health-check polling for `jira` binary; replace with a
      credentials-presence check
- [ ] Update plugin activation: healthy when all three credentials are present

**Outcome**: Jira works with zero CLI tools. SSO-compatible by default.

---

## Phase 5 — Jira: OAuth 3LO (future / optional)

For enterprise orgs that disable API token creation, implement full
Atlassian OAuth 2.0 3LO.

- [ ] Register an Atlassian OAuth 2.0 app in the developer console
      (callback URL: `agentkeeper://oauth/jira`)
- [ ] Implement PKCE browser flow in `main/auth.ts` (same pattern as GitHub)
- [ ] Store access + refresh tokens in keytar
- [ ] Implement token refresh before expiry (Atlassian uses rotating refresh
      tokens — store each new refresh token on use)
- [ ] Update settings UI with "Connect with Atlassian" button alongside the
      API token option

---

## Sequencing

```
Phase 0  ──►  Phase 1  ──►  Phase 2
                             │
                             ├──►  Phase 3a  ──►  Phase 3b
                             │
                             └──►  Phase 4a  ──►  Phase 4b
                                                       │
                                                       └──►  Phase 5 (optional)
```

Phase 0 is a prerequisite for knowing whether the Claude binary bundling is
already solved. Phases 3 and 4 are independent and can be parallelised across
worktrees. Phase 5 is deferred until there's a concrete org that blocks on it.

---

## Files touched (summary)

| File | Change |
|------|--------|
| `apps/desktop/src/main/secrets.ts` | Remove OAuth fallback; add `getGithubToken`, `getJiraToken` helpers |
| `apps/desktop/src/main/agent.ts` | Resolve bundled binary path; remove CLI PATH assumption |
| `apps/desktop/src/main/ipc.ts` | Add `github.auth.*` and `jira.auth.*` channels |
| `apps/desktop/src/main/index.ts` | Register `agentkeeper://` protocol; handle deep-link redirect |
| `apps/desktop/src/preload/index.ts` | Expose new auth IPC methods |
| `apps/desktop/src/shared/ipc-contract.ts` | Add new channel constants + type signatures |
| `apps/desktop/src/renderer/src/views/SetupWizard.vue` | New first-run view |
| `apps/desktop/src/renderer/src/components/settings/*` | Update Claude, GitHub, Jira panels |
| `plugins/github/src/github-api.ts` | New file; replaces `github-cli.ts` |
| `plugins/github/src/index.ts` | Read token from keytar; construct Octokit |
| `plugins/jira/src/jira-api.ts` | New file; replaces `jira-cli.ts` |
| `plugins/jira/src/index.ts` | Read credentials from keytar; health-check update |
