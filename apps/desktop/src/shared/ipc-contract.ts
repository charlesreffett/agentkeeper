// Shared between main, preload, and renderer. Pure types/constants only — no
// runtime imports from Electron or Node.

import type { IssueTransition, StatusCategory, WorkItem, WorkItemCreateParams, WorkItemReference, WorkItemStatus } from '@agentkeeper/sdk'
export type { IssueTransition, StatusCategory, WorkItem, WorkItemCreateParams, WorkItemReference, WorkItemStatus }
import type { PluginManifest, PluginPermission } from '@agentkeeper/sdk'
import type { HarnessCapabilities, HarnessConfigurationDescriptor, HarnessAuthenticationDescriptor, SessionControlDescriptor } from '@agentkeeper/core'
export type { HarnessCapabilities, HarnessConfigurationDescriptor, HarnessAuthenticationDescriptor, SessionControlDescriptor, SessionControlSelection, SessionControlValue } from '@agentkeeper/core'

// ─── General (no-project) sessions ─────────────────────────────────────────

/** True when a session has no project attached (`projectPath` is null). No-project
 *  chats run with `os.homedir()` as their cwd and skip all project-scoped
 *  features (worktrees, plan MCP tools, project roles/agencies). */
export function isGeneralProject(projectPath: string | null | undefined): projectPath is null | undefined {
  return !projectPath
}

// ─── Attachments ────────────────────────────────────────────────────────────

export interface Attachment {
  name: string
  mimeType: string
  /** base64 for images; UTF-8 text for everything else */
  content: string
}

export interface DraftRecord {
  text: string
  attachments: Attachment[]
}

// ─── Remote sources ─────────────────────────────────────────────────────────

export interface RemoteSource {
  type: 'github' | 'gitlab' | 'bitbucket'
  /** owner/repo slug */
  repo: string
  /** git remote name, e.g. "origin" */
  remote: string
  url: string
}

/** Provider-neutral metadata persisted for a project's configured Git remote. */
export interface ProjectRemote {
  name: string
  url: string
  provider?: string
  repository?: string
}

// ─── Projects ───────────────────────────────────────────────────────────────

export interface RecentProject {
  path: string
  name: string
  remotes: ProjectRemote[]
  lastOpenedAt: number
}

export interface CreateProjectParams {
  name: string
  parentDir: string
  dirName: string
}

export interface GitChange {
  path: string
  status: string
}

export interface GitStatus {
  staged: GitChange[]
  unstaged: GitChange[]
  untracked: string[]
}

export interface CommitGroup {
  message: string
  files: string[]
  explanation: string
}

export interface CommitSuggestion {
  overview: string
  groups: CommitGroup[]
}

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
}

export interface GitStatusChangedEvent {
  projectPath: string
}

export interface GitBranchChangedEvent {
  projectPath: string
}

export interface BranchInfo {
  name: string
  isCurrent: boolean
  /** Repo default branch (origin/HEAD target, falling back to main/master). Always listed first. */
  isDefault: boolean
  isRemote: boolean
  upstream: string | null
  /** As of last fetch. */
  ahead: number
  /** As of last fetch. */
  behind: number
  lastCommitSubject: string
  lastCommitDate: string
  /** Set when the branch is checked out in a worktree — cannot be switched to in the main repo. */
  worktreePath: string | null
  /** Checkout-recency ordinal from the reflog (0 = most recent). null = not in recent history. */
  recentRank: number | null
}

export interface SwitchBranchOptions {
  /** Push through the dirty-tree soft-reject. Changes are carried over, never discarded. */
  allowDirty?: boolean
}

export type SwitchResult =
  | { ok: true }
  /** Our soft-reject; retry with allowDirty to push through. */
  | { ok: false; blocked: 'dirty' }
  /** Git refused; uncommitted changes would be overwritten. Needs commit/stash. */
  | { ok: false; blocked: 'conflict'; reason: string }
  /** A session is running with cwd == projectPath. Never forceable. */
  | { ok: false; blocked: 'live-session' }
  /** Any other git failure (missing branch, index.lock, …). */
  | { ok: false; blocked: 'git-error'; reason: string }

export interface FsChangedEvent {
  projectPath: string
}

// ─── Plan todos ─────────────────────────────────────────────────────────────

export type PlanTodoStatus = 'pending' | 'in_progress' | 'completed' | 'partial'

export interface PlanTodo {
  id: string
  content: string
  status: PlanTodoStatus
  priority?: string
}

// ─── Sessions (historical, JSONL-backed) ────────────────────────────────────

export interface SessionSummary {
  id: string
  path: string
  startedAt: number
  lastActivityAt: number
  messageCount: number
  model: string | null
  firstUserMessage: string | null
  gitBranch: string | null
}

export type EventKind =
  | 'user'
  | 'assistant'
  | 'system'
  | 'progress'
  | 'summary'
  | 'other'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result'
      tool_use_id: string
      content: unknown
      is_error?: boolean
    }
  | { type: 'image'; source: unknown }
  | { type: 'unknown'; raw: unknown }

export interface TranscriptEvent {
  uuid: string
  parentUuid: string | null
  timestamp: string
  kind: EventKind
  role: 'user' | 'assistant' | 'system' | null
  isMeta: boolean
  isSidechain: boolean
  model: string | null
  content: ContentBlock[]
  parentToolUseId: string | null
  systemSubtype: string | null
}

export interface SessionTranscript {
  id: string
  path: string
  projectPath: string | null
  gitBranch: string | null
  versions: string[]
  events: TranscriptEvent[]
  lastActivityAt: number
}

// ─── Live sessions (Agent SDK–driven) ───────────────────────────────────────

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'

export type LiveSessionStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'blocked'
  | 'suspended'
  | 'completed'
  | 'inactive'
  | 'error'

export interface Agent {
  localId: string
  sessionLocalId: string
  sdkSessionId: string | null
  roleId: string | null
  roleName: string | null
  roleInstanceIndex: number | null
  initialPrompt: string
  isEntryPoint: boolean
  status: LiveSessionStatus
  startedAt: number
  lastActivityAt: number
}

export interface Session {
  localId: string
  /** The logical project the session belongs to. null = no-project (general) session. */
  projectPath: string | null
  worktreePath: string | null
  branch: string | null
  model: string | null
  effort: RoleEffort | null
  permissionMode: PermissionMode | null
  /** Harness adapter id that ran this session (e.g. 'claude-code'). Determines
   *  JSONL layout and message-uuid lookup. Always set on persisted sessions;
   *  may be undefined on transient renderer-constructed sessions. */
  harnessId?: string
  initialPrompt: string
  agencyName: string | null
  agencyId: string | null
  agencyScope: AgencyScope | null
  startedAt: number
  lastActivityAt: number
  lastUserMessageAt: number | null
  status: LiveSessionStatus
  workItem: WorkItemReference | null
  title: string | null
  planState: PlanTodo[] | null
  /** Computed — not stored; populated by registry queries. */
  agentCount?: number
}

export interface StartSessionParams {
  /**
   * Caller-supplied agent id. For solo sessions this is also the session id.
   * If omitted, main generates one — the value returned from start() is authoritative.
   */
  localId?: string
  /**
   * Pre-supplied agent UUID. When provided the agent is attached to an existing
   * session instead of creating a new session row.
   */
  agentLocalId?: string
  /**
   * Attach this agent to an existing session. When set, no session row is
   * created — only an agents row. Omit for solo sessions (session and agent
   * share the same UUID).
   */
  sessionLocalId?: string
  /** The logical project the session belongs to (the main repo root).
   *  null = no-project (general) session. */
  projectPath: string | null
  /**
   * Actual cwd for the SDK subprocess. Defaults to projectPath. Set this
   * to a worktree path when a session should run in a separate branch/dir.
   */
  worktreePath?: string
  initialPrompt: string
  model?: string
  /** Harness adapter id to run this session on. Defaults to the active harness. */
  harnessId?: string
  effort?: RoleEffort
  permissionMode?: PermissionMode
  /** Role-derived options — appended to the default Claude Code preset. */
  systemPromptAppend?: string
  /** Tools removed from the model's context entirely (hard deny). */
  disallowedTools?: string[]
  roleId?: string
  /** 1-based instance index within the role. */
  roleInstanceIndex?: number
  /** Agency definition id — persisted so resumeAgency can reload the agency config. */
  agencyId?: string
  /** Scope of the agency definition. */
  agencyScope?: AgencyScope
  /** Provider-addressed work item to attach as context for the session. */
  workItem?: WorkItemReference | null
  /** Resume an existing SDK session by its session_id. When set, the session
   *  starts in 'idle' and no initial prompt is pushed to the queue. */
  resumeSdkSessionId?: string
  /** Attachments to include with the initial user message. */
  initialAttachments?: Attachment[]
  /** Role display name — persisted so the registry can show it without a role lookup. */
  roleName?: string
  /** Agency display name — persisted for the same reason. */
  agencyName?: string
  /** Whether this agent is the entry point (received the user's original prompt). */
  isEntryPoint?: boolean
  /** IDs of McpServerEntry entries from AppSettings.mcpServers to activate for this session. */
  mcpServerIds?: string[]
}

export interface AddAgentParams {
  roleName?: string
  roleId?: string
  initialPrompt: string
  model?: string
  effort?: RoleEffort
  permissionMode?: PermissionMode
  systemPromptAppend?: string
}

// ─── Worktrees ──────────────────────────────────────────────────────────────

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
}

export interface GitDiffStatFile {
  file: string
  added: number
  removed: number
}

// ─── Skills ─────────────────────────────────────────────────────────────────

export interface SkillPreview {
  id: string
  name: string
  description: string
}

export interface Skill {
  id: string
  scope: 'project' | 'global'
  /** Owning project for project-scoped skills, including in the All view. */
  projectPath?: string
  /** Stable physical identity. Symlinked registrations share one record. */
  path: string
  /** Every on-disk registration that resolves to this skill. */
  locations: string[]
  /** Harnesses that discover at least one of the registrations. */
  harnessIds: string[]
  /** True when the physical skill lives in AgentKeeper's canonical store. */
  managed: boolean
  /** Another physical skill with this id exists at the same scope. */
  conflict: boolean
  name: string
  description: string
  body: string
}

// ─── Commands ────────────────────────────────────────────────────────────────

export interface SlashCommand {
  id: string
  /** 'plugin' = read-only; contributed by an installed Claude Code plugin. */
  scope: 'project' | 'global' | 'plugin'
  projectPath?: string
  path: string
  locations: string[]
  harnessIds: string[]
  shared: boolean
  conflict: boolean
  representation?: 'markdown' | 'generated'
  name: string
  body: string
  /** Human-readable plugin name when scope === 'plugin'. */
  pluginName?: string
}

// ─── Roles ──────────────────────────────────────────────────────────────────

export type RoleScope = 'project' | 'global'

export type RoleEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const ROLE_EFFORT_VALUES: RoleEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export interface Role {
  id: string
  scope: RoleScope
  path: string
  name: string
  description: string
  harnessId: string | null
  model: string | null
  effort: RoleEffort | null
  systemPrompt: string
  icon?: string
  accent?: string
}

export type RoleDraft = Omit<Role, 'scope' | 'path'>

export interface RolesGenerateResult {
  id: string
  name: string
  description: string
  systemPrompt: string
}

// ─── Agencies ───────────────────────────────────────────────────────────────

export type AgencyScope = 'project' | 'global'

export type OnFailurePolicy = 'block' | 'continue' | 'retry'

export interface RoleSlot {
  roleId: string
  // count and min/max are mutually exclusive sizing modes (see parseAgency in
  // main/agencies.ts): count wins when both are given in the role file — min/max
  // are only parsed when count is absent.
  count?: number   // static — always this many (undefined = 1)
  min?: number     // dynamic floor
  max?: number     // dynamic ceiling
  openMessaging?: boolean
  onFailure?: OnFailurePolicy
  pauseForReview?: boolean
}

/** Live scaling state for one role of a running agency. `live` counts instances
 *  holding a slot against `ceiling`; retired ones keep their ids but are
 *  excluded. Sizing config alone cannot express this — an elastic role's ids
 *  accumulate across a run while its live population stays under the ceiling. */
export interface AgencyRoleCapacity {
  roleId: string
  live: number
  floor: number
  ceiling: number
  busy: number
  idle: number
  queued: number
}

export interface AgencyScalingUpdate extends AgencyRoleCapacity {
  agencyInstanceId: string
}

export interface Agency {
  id: string
  scope: AgencyScope
  path: string
  name: string
  description: string
  roles: RoleSlot[]
  flows: Array<[string, string, string?, string?]>
  entryPoints: string[]
  notes: string
  layout?: Record<string, { x: number; y: number }>
}

export type AgencyDraft = Omit<Agency, 'scope' | 'path'>

/** Parameters to launch an agency: creates one shared worktree (optional)
 *  and spawns one session per role. Entry-point roles receive initialPrompt. */
export interface StartAgencyParams {
  /** null = no-project (general) agency. */
  projectPath: string | null
  agencyId: string
  agencyScope: AgencyScope
  initialPrompt: string
  initialAttachments?: Attachment[]
  useWorktree: boolean
  /** Exact branch/ref the new worktree branch starts from. */
  baseBranch?: string
  branch?: string
  model?: string
  /** Harness adapter used by every member of this agency. */
  harnessId?: string
  workItem?: WorkItemReference | null
}

export interface AgencyInstanceSession {
  /** Agent UUID. */
  localId: string
  /** Session UUID — all agents in the same agency share this. */
  sessionLocalId: string
  roleId: string        // base role id, e.g. "developer"
  instanceId: string    // qualified: "developer-1", "developer-2", etc.
  instanceIndex: number // 1-based
  roleName: string
  harnessId?: string
  model?: string
  isEntryPoint: boolean
  isOverflow: boolean   // true if spawned above the min floor
}

export interface AgencyInstance {
  instanceId: string
  agencyId: string
  agencyName: string
  /** null = no-project (general) agency. */
  projectPath: string | null
  worktreePath: string | null
  branch: string | null
  sessions: AgencyInstanceSession[]
}

/** SDK message forwarded to renderer as-is (plain object, structured-clone-safe). */
export interface LiveSessionEvent {
  sessionId: string
  /** Agent that produced this event. Present for all agent-originated events. */
  agentLocalId?: string
  message: unknown
  /** Set on the initial user-message broadcast. Lets the renderer classify the
   *  first message correctly even when it arrives before the agent roster does
   *  (agency startup race): entry-point → real user prompt, otherwise a
   *  synthetic "await peers" brief. */
  isEntryPoint?: boolean
}

export interface LiveSessionStatusUpdate {
  sessionId: string
  /** Present = agent-level status update; absent = session-level update. */
  agentLocalId?: string
  status?: LiveSessionStatus
  sdkSessionId?: string
  error?: string
  title?: string
}

/** Pushed from main to renderer once per query turn, when a result message arrives. */
export interface LiveSessionStats {
  /** Total sessions currently in the in-memory active Map. */
  activeSessionCount: number
  /** Sessions with status 'running' or 'starting'. */
  runningSessionCount: number
  /** Token + cost usage for the completed turn. */
  turnUsage: {
    sessionId: string
    agentLocalId: string
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    totalCostUsd: number
    inputCostUsd: number
    outputCostUsd: number
    cacheReadCostUsd: number
    cacheCreationCostUsd: number
  }
}

// ─── MCP servers ────────────────────────────────────────────────────────────

export type McpServerType = 'stdio' | 'http' | 'sse'

export interface McpServerEntry {
  id: string
  /** Display name shown in the UI. */
  name: string
  type: McpServerType
  /** stdio: the executable to run. */
  command?: string
  /** stdio: arguments passed to the command. */
  args?: string[]
  /** stdio: extra environment variables for the subprocess. */
  env?: Record<string, string>
  /** http / sse: the endpoint URL. */
  url?: string
  /** http / sse: request headers. */
  headers?: Record<string, string>
  /** When true this server is pre-checked in the new-session panel. */
  enabledByDefault: boolean
}

// ─── Settings & secrets ─────────────────────────────────────────────────────

export interface AppSettings {
  /** Explicit user consent for loading mutable unpacked plugins. Default false. */
  pluginDeveloperMode: boolean
  defaultModel: string
  defaultEffort: RoleEffort
  /** When true, new sessions default to creating an isolated git worktree. Default false. */
  defaultUseWorktree: boolean
  /** When true: Enter sends, modifier+Enter inserts a newline. Default false. */
  enterToSend: boolean
  /** Which modifier triggers send. 'auto' = platform default (meta on Mac, ctrl elsewhere). */
  sendModifier: 'auto' | 'meta' | 'ctrl' | 'alt' | 'shift'
  /** When true, persisted sessions older than sessionExpiryDays are pruned on app startup and shutdown. Opt-in; default false. */
  sessionExpiryEnabled: boolean
  /** Days of inactivity before a persisted session is auto-pruned, when sessionExpiryEnabled. null = never expire. */
  sessionExpiryDays: number | null
  theme: 'system' | 'light' | 'dark'
  notifications: 'all' | 'notification-only' | 'sound-only' | 'toast' | 'disabled'
  notificationSound: 'chime' | 'bell' | 'ping' | 'ding' | 'pulse'
  /** User-configured external MCP servers available to sessions. */
  mcpServers: McpServerEntry[]
  /** Active harness adapter id. Defaults to 'claude-code' when undefined. */
  harnessId?: string
  /** Per-harness binary path overrides, keyed by harness id (e.g. claude-code
   *  → /path/to/claude). Empty means PATH lookup with *_BIN env fallback. */
  harnessBins?: Record<string, string>
  /** Non-secret values for adapter-declared configuration fields. */
  harnessConfig?: Record<string, Record<string, string | boolean>>
  /** Sanitized off-catalog model ids merged into catalogs for capable harnesses. */
  customModels?: Record<string, string[]>
  mobileServer?: { enabled: boolean; port: number; secretKey: string }
  /** Skip the dirty-tree warning when switching branches (changes are carried over, never lost). Default false. */
  gitSwitchWithoutSoftReject?: boolean
  /** Last model the user picked, keyed by harness id. New drafts on a harness
   *  start from this when present, before falling back to `defaultModel` — a
   *  pick made while browsing another harness must not leak into it. */
  lastUsedModels?: Record<string, string>
}

export interface HarnessInfo {
  id: string
  name: string
  available: boolean
  /** Human-readable reason when `available` is false — shown verbatim in the UI. */
  unavailableReason?: string
  defaultModel: string
  capabilities: HarnessCapabilities
  configuration?: HarnessConfigurationDescriptor
  authentication?: HarnessAuthenticationDescriptor
  /** Adapter-owned session controls such as permission policy and mode. */
  controls?: SessionControlDescriptor[]
}

/** Per-harness auth status for the diagnostics surface. `ready` means a usable
 *  credential is present; `detail` explains what's configured. */
export interface HarnessAuthInfo {
  id: string
  /** 'api-key' (key stored), 'cli' (relies on `claude login`), or 'provider'
   *  (open-code style auth store). */
  type: string
  status: 'authenticated' | 'unauthenticated' | 'expired' | 'unknown' | 'not-required'
  /** Authenticated provider ids (opencode) — empty otherwise. */
  providers?: string[]
  detail?: string
}

export interface HarnessConfigurationState {
  values: Record<string, string | boolean>
  secretFields: string[]
}

// ─── Factory reset ──────────────────────────────────────────────────────────

export interface ResetRequest {
  /** settings.json and all stored secrets (keychain API key, etc.). */
  appSettings: boolean
  /** `~/.agentkeeper/` role and agency definitions. */
  globalDefinitions: boolean
  /** `<projectPath>/.agentkeeper/` — set to null to skip. */
  projectDefinitions: { projectPath: string } | null
}

export interface ResetResult {
  appSettingsCleared: boolean
  globalDefinitionsCleared: boolean
  projectDefinitionsCleared: boolean
  errors: string[]
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export type PlanStatus = 'planned' | 'drafting' | 'running' | 'complete' | 'archived'
export type PlanStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped' | 'replanning'
export type PlanAgentType = 'explorer' | 'main' | 'qa' | 'doc' | string

export interface PlanStep {
  id: string
  title: string
  /** Brief one-liner shown collapsed and in SUMMARY when expanded. */
  summary?: string
  /** Detailed instructions shown under FULL INSTRUCTIONS when expanded. */
  instructions?: string
  /** File paths in scope for this step. */
  filesInScope?: string[]
  model: string
  estimatedMinutes: number
  /** Actual elapsed minutes — set after the step completes. */
  actualMinutes?: number
  agent: PlanAgentType
  parallel: boolean
  status: PlanStepStatus
  /** Pause plan execution after this step completes and wait for the user to manually approve continuation. */
  requiresApproval?: boolean
  /** User-provided context injected into this step's execution prompt. */
  context?: string
}

export interface Plan {
  id: string
  /** Short identifier shown as PL-01, PL-02 etc. Derived from list position if absent. */
  planRef?: string
  title: string
  /** The original prompt that triggered planning. */
  prompt?: string
  workItem?: WorkItemReference | null
  agencyId?: string | null
  agencyScope?: AgencyScope | null
  status: PlanStatus
  estimatedMinutes: number
  createdAt: string
  updatedAt: string
  /** Computed from single session_id column. */
  sessionIds: string[]
  steps: PlanStep[]
}

export type PlansCreateInput = Omit<Plan, 'id' | 'createdAt' | 'updatedAt' | 'sessionIds'> & {
  sessionIds?: string[]
}

export interface PlansStepPatch {
  status?: PlanStepStatus
  startedAt?: number | null
  completedAt?: number | null
  failedAt?: number | null
  actualMinutes?: number | null
}

export type PlansUpdateInput = Partial<Omit<Plan, 'id' | 'createdAt'>> & {
  /** Atomic single-step update — when provided together with stepId, only that row is updated. */
  stepId?: string
  stepPatch?: PlansStepPatch
}

// ─── Session stats ───────────────────────────────────────────────────────────

export interface SessionStatRow {
  sessionLocalId: string
  totalTokens: number
  totalCostUsd: number
  turnCount: number
  inProgressTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
}

// ─── Cost ledger ─────────────────────────────────────────────────────────────

export interface DayTotal {
  date: string     // YYYY-MM-DD
  costUsd: number
  tokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface ProjectDayTotal extends DayTotal {
  projectPath: string
}

export interface ModelPricing {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export type ModelEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** A model the active harness reports as runnable. The harness is the sole
 *  authority; the app never invents or cross-references this list. */
export interface AvailableModel {
  value: string
  label: string
  description?: string
  /** Provider serving the model, e.g. `anthropic` — for badges/grouping. */
  provider?: string
  /** Concrete model an alias/`default` resolves to, e.g. `claude-opus-4-8`.
   *  Lets the UI always show the real model+version, not the alias label. */
  resolvedModel?: string
  contextWindow?: number
  isCustom?: boolean
  supportsEffort?: boolean
  effortLevels?: ModelEffortLevel[]
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
  isDefault?: boolean
  controls?: SessionControlDescriptor[]
}

export interface HarnessModelSnapshot {
  harnessId: string
  models: AvailableModel[]
  status: 'cached' | 'refreshing' | 'ready' | 'error'
  refreshedAt: number | null
  /** Refresh errors retain the last successful models. */
  error?: string
}

/** @deprecated Use HarnessModelSnapshot. */
export type ModelsListResult = HarnessModelSnapshot

export type SetModelResult =
  | { ok: true }
  | { ok: false; reason: 'model-selection-unsupported' | 'session-running' | 'session-terminal' | 'agency-owned' | 'model-invalid' | 'session-not-found'; message: string }

export interface LegacyDayEntry {
  date: string
  tokens: number
  costUsd: number
}

// ─── Plugin management ───────────────────────────────────────────────────────

export type PluginSource = 'bundled' | 'local' | 'dev'
export type PluginStatus = 'active' | 'inactive' | 'unhealthy'

export interface PluginAuthoritySnapshot {
  permissions: PluginPermission[]
  networkHosts: string[]
  environmentVariables: string[]
}

export interface PluginRecord {
  id: string
  name: string
  version: string
  enabled: boolean
  source: PluginSource
  status: PluginStatus
  unhealthyReason?: string
  manifest: PluginManifest
  actionRequired: boolean
  grantedAuthority: PluginAuthoritySnapshot
  /** Present only for unpacked development plugins. */
  devPath?: string
}

export interface UpdateAvailable {
  pluginId: string
  currentVersion: string
  availableVersion: string
  releaseNotes?: string
}

export interface PluginUpdateResult {
  actionRequired: boolean
  addedAuthority: PluginAuthoritySnapshot
}

export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'
  | 'unsupported'

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  progressPercent?: number
  message?: string
}

// ─── IPC API exposed to renderer as window.agentkeeper ──────────────────────

export interface AgentKeeperApi {
  appUpdates: {
    getState: () => Promise<AppUpdateState>
    check: () => Promise<AppUpdateState>
    download: () => Promise<void>
    install: () => Promise<void>
    onStateChanged: (callback: (state: AppUpdateState) => void) => () => void
  }
  projects: {
    add: (path: string) => Promise<RecentProject>
    remove: (path: string) => Promise<void>
    rename: (oldPath: string, newName: string, renameDir: boolean) => Promise<RecentProject>
    update: (oldPath: string, name: string, sourcePath: string) => Promise<RecentProject>
    reveal: (path: string) => Promise<void>
    reorder: (paths: string[]) => Promise<void>
    list: () => Promise<RecentProject[]>
    getFocused: () => Promise<RecentProject | null>
    setFocused: (path: string | null) => Promise<void>
    pickFolder: () => Promise<string | null>
    create: (params: CreateProjectParams) => Promise<RecentProject>
    getPinnedBranches: (path: string) => Promise<string[]>
    setPinnedBranches: (path: string, branches: string[]) => Promise<void>
  }
  project: {
    pick: () => Promise<RecentProject | null>
    recent: {
      list: () => Promise<RecentProject[]>
      remove: (path: string) => Promise<void>
    }
  }
  sessions: {
    list: (projectPath: string | null) => Promise<SessionSummary[]>
    read: (
      projectPath: string | null,
      sessionId: string,
      harnessId?: string,
    ) => Promise<SessionTranscript | null>
    start: (params: StartSessionParams) => Promise<string>
    sendInput: (sessionId: string, text: string, attachments?: Attachment[]) => Promise<void>
    interrupt: (sessionId: string) => Promise<boolean>
    terminate: (sessionId: string) => Promise<void>
    onEvent: (callback: (event: LiveSessionEvent) => void) => () => void
    onStatus: (
      callback: (update: LiveSessionStatusUpdate) => void,
    ) => () => void
    onStats: (callback: (stats: LiveSessionStats) => void) => () => void
    onCreated: (callback: (localId: string) => void) => () => void
    onDeleted: (callback: (localId: string) => void) => () => void
    listPersisted: (projectPath: string | null) => Promise<Session[]>
    getByLocalId: (localId: string) => Promise<Session | null>
    resume: (localId: string) => Promise<string>
    deletePersisted: (localId: string) => Promise<void>
    touchPersisted: (localId: string) => Promise<void>
    setModel: (localId: string, model: string) => Promise<SetModelResult>
    setEffort: (localId: string, effort: RoleEffort) => Promise<void>
    setPermissionMode: (localId: string, mode: PermissionMode) => Promise<void>
    deleteHistorical: (projectPath: string | null, sessionId: string) => Promise<void>
    deleteAllHistorical: (projectPath: string | null) => Promise<void>
    deleteAllPersisted: (projectPath: string | null) => Promise<void>
    getAgents: (sessionLocalId: string) => Promise<Agent[]>
    addAgent: (sessionLocalId: string, params: AddAgentParams) => Promise<string>
    listTrackedSdkIds: (projectPath: string | null) => Promise<string[]>
    reconnectMcp: (agentLocalId: string) => Promise<void>
    editAndRerun: (agentLocalId: string, truncateFromUuid: string, newText: string, originalText?: string | null, attachments?: Attachment[]) => Promise<void>
    undoEditAndRerun: (agentLocalId: string) => Promise<void>
  }
  worktrees: {
    list: (projectPath: string) => Promise<WorktreeInfo[]>
    create: (projectPath: string, options: { baseRef?: string; branchRequest: string }) => Promise<WorktreeInfo>
    remove: (projectPath: string, worktreePath: string) => Promise<void>
    gitDiffStat: (worktreePath: string, baseBranch?: string) => Promise<GitDiffStatFile[]>
  }
  roles: {
    list: (projectPath: string | null) => Promise<Role[]>
    save: (
      scope: RoleScope,
      projectPath: string | null,
      role: RoleDraft,
    ) => Promise<Role>
    remove: (scope: RoleScope, projectPath: string | null, id: string) => Promise<void>
    generate: (prompt: string) => Promise<RolesGenerateResult>
  }
  agencies: {
    list: (projectPath: string | null) => Promise<Agency[]>
    save: (
      scope: AgencyScope,
      projectPath: string | null,
      agency: AgencyDraft,
    ) => Promise<Agency>
    remove: (
      scope: AgencyScope,
      projectPath: string | null,
      id: string,
    ) => Promise<void>
    start: (params: StartAgencyParams) => Promise<AgencyInstance>
    resume: (instanceId: string) => Promise<AgencyInstance>
    setFallbackModel: (instanceId: string, model: string) => Promise<SetModelResult>
    onScaling: (callback: (update: AgencyScalingUpdate) => void) => () => void
  }
  skills: {
    list: (projectPath: string) => Promise<Skill[]>
    install: (
      projectPath: string,
      source: string,
      scope: 'project' | 'global',
      skillIds?: string[],
    ) => Promise<void>
    remove: (projectPath: string, skill: Skill) => Promise<void>
    adopt: (projectPath: string, skill: Skill) => Promise<void>
    preview: (projectPath: string, source: string) => Promise<SkillPreview[]>
    generate: (prompt: string) => Promise<string>
    save: (
      projectPath: string,
      id: string,
      scope: 'project' | 'global',
      content: string,
    ) => Promise<Skill>
  }
  commands: {
    list: (projectPath: string) => Promise<SlashCommand[]>
    generate: (prompt: string) => Promise<string>
    save: (
      scope: 'project' | 'global',
      projectPath: string,
      id: string,
      body: string,
      existing?: SlashCommand,
    ) => Promise<SlashCommand>
    remove: (projectPath: string, cmd: SlashCommand) => Promise<void>
    adopt: (projectPath: string, cmd: SlashCommand) => Promise<void>
    /** Fires when command registrations or plugin contributions change. */
    onChanged: (callback: () => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (partial: Partial<AppSettings>) => Promise<AppSettings>
  }
  notifications: {
    trigger: (sessionLocalId: string, sessionTitle: string, silent: boolean) => Promise<void>
    onNavigate: (callback: (sessionLocalId: string) => void) => () => void
  }
  reset: {
    execute: (request: ResetRequest) => Promise<ResetResult>
  }
  plugins: {
    getConfig: (pluginId: string) => Promise<unknown>
    setConfig: (pluginId: string, config: unknown) => Promise<void>
    onEvent: (handler: (event: string, payload: unknown) => void) => () => void
    /** Fires when the OS asks the app to open a .akp file (macOS open-file / Win second-instance). */
    onOpenFile: (handler: (filePath: string) => void) => () => void
    /** Fires when a plugin host contributes a UI element to a named slot. */
    onUiContribution: (handler: (data: { pluginId: string; slot: string; contribution: unknown }) => void) => () => void
    list: () => Promise<PluginRecord[]>
    pickAkpFile: () => Promise<string | null>
    prepareAkpInstall: (opts: { filePath?: string; manifestUrl?: string }) => Promise<{ manifest: PluginManifest; token: string }>
    confirmAkpInstall: (token: string) => Promise<void>
    cancelAkpInstall: (token: string) => Promise<void>
    getDeveloperMode: () => Promise<boolean>
    setDeveloperMode: (enabled: boolean) => Promise<boolean>
    loadDev: (dirPath?: string) => Promise<{ manifest: PluginManifest; token: string } | null>
    unloadDev: (pluginId: string) => Promise<void>
    uninstall: (pluginId: string) => Promise<void>
    enable: (pluginId: string) => Promise<void>
    approvePermissions: (pluginId: string) => Promise<void>
    disable: (pluginId: string) => Promise<void>
    checkUpdates: () => Promise<UpdateAvailable[]>
    update: (pluginId: string) => Promise<PluginUpdateResult>
    invoke: (pluginId: string, commandId: string, args?: unknown) => Promise<unknown>
    getRendererBundle: (pluginId: string, viewId: string) => Promise<{ script: string }>
  }
  workItems: {
    list: (sourceId?: string) => Promise<WorkItem[]>
    get: (reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>) => Promise<WorkItem | undefined>
    updateStatus: (reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, status: WorkItemStatus) => Promise<void>
    getTransitions: (reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>) => Promise<IssueTransition[]>
    transition: (reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, name: string) => Promise<void>
    create: (sourceId: string, params: WorkItemCreateParams) => Promise<WorkItem>
  }
  remotes: {
    detect: (projectPath: string) => Promise<RemoteSource[]>
  }
  dialog: {
    openFiles: () => Promise<Attachment[]>
  }
  git: {
    getBranch: (projectPath: string) => Promise<string | null>
    getStatus: (projectPath: string) => Promise<GitStatus>
    stageFiles: (projectPath: string, files: string[]) => Promise<void>
    unstageFiles: (projectPath: string, files: string[]) => Promise<void>
    commit: (projectPath: string, message: string) => Promise<void>
    push: (projectPath: string) => Promise<string>
    pull: (projectPath: string) => Promise<string>
    createBranch: (projectPath: string, branchName: string) => Promise<void>
    listBranches: (projectPath: string) => Promise<BranchInfo[]>
    isRepo: (projectPath: string) => Promise<boolean>
    switchBranch: (projectPath: string, name: string, opts?: SwitchBranchOptions) => Promise<SwitchResult>
    switchBranchCreate: (projectPath: string, name: string, from?: string) => Promise<SwitchResult>
    suggestCommits: (projectPath: string) => Promise<CommitSuggestion>
    onStatusChanged: (cb: (event: GitStatusChangedEvent) => void) => () => void
    onBranchChanged: (cb: (event: GitBranchChangedEvent) => void) => () => void
  }
  fs: {
    listDirectory: (dirPath: string) => Promise<FsEntry[]>
    watchStart: (projectPath: string) => Promise<void>
    watchStop: (projectPath: string) => Promise<void>
    onChanged: (cb: (event: FsChangedEvent) => void) => () => void
  }
  plans: {
    list: (projectPath: string) => Promise<Plan[]>
    get: (projectPath: string, id: string) => Promise<Plan | null>
    create: (projectPath: string, data: PlansCreateInput) => Promise<Plan>
    update: (projectPath: string, id: string, patch: PlansUpdateInput) => Promise<Plan | null>
    delete: (projectPath: string, id: string) => Promise<boolean>
    onUpdated: (cb: (data: { projectPath: string; id: string }) => void) => () => void
  }
  costs: {
    getDailySummary: () => Promise<DayTotal[]>
    getDailySummaryByProject: () => Promise<ProjectDayTotal[]>
    addLegacy: (entries: Array<LegacyDayEntry>) => Promise<void>
  }
  pricing: {
    getTable: () => Promise<Record<string, ModelPricing>>
    refresh: () => Promise<Record<string, ModelPricing>>
  }
  models: {
    list: (harnessId?: string) => Promise<ModelsListResult>
    refresh: (harnessId?: string) => Promise<ModelsListResult>
    onChanged: (callback: (snapshot: HarnessModelSnapshot) => void) => () => void
  }
  drafts: {
    get: (sessionLocalId: string) => Promise<DraftRecord>
    set: (sessionLocalId: string, text: string, attachments: Attachment[]) => Promise<void>
    clear: (sessionLocalId: string) => Promise<void>
  }
  stats: {
    getAll: () => Promise<SessionStatRow[]>
    upsert: (sessionLocalId: string, totalTokens: number, totalCostUsd: number, turnCount: number, inProgressTokens: number) => Promise<void>
    importLegacy: (entries: SessionStatRow[]) => Promise<void>
  }
  terminal: {
    create: (cwd: string) => Promise<string>
    attach: (id: string) => Promise<string>
    sendInput: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    destroy: (id: string) => Promise<void>
    kill: (id: string) => Promise<void>
    onData: (handler: (id: string, data: string) => void) => () => void
  }
  harness: {
    list: () => Promise<HarnessInfo[]>
    getActive: () => Promise<HarnessInfo>
    setActive: (id: string) => Promise<void>
    /** Auth/availability diagnostics for every registered harness. */
    auth: () => Promise<HarnessAuthInfo[]>
    getConfiguration: (id: string) => Promise<HarnessConfigurationState>
    setConfiguration: (id: string, values: Record<string, string | boolean>) => Promise<void>
    setSecret: (id: string, fieldId: string, value: string) => Promise<void>
    deleteSecret: (id: string, fieldId: string) => Promise<void>
    authenticate: (id: string) => Promise<string>
  }
  mobile: {
    generateKey: () => Promise<string>
    getLocalIp: () => Promise<string>
  }
  performance: {
    getSummary: (opts: { projectPath: string | null; rangeDays: number }) => Promise<PerformanceSummary>
  }
  /** Only present in development builds (`!app.isPackaged`). */
  dev?: {
    runMigrations: () => Promise<{ applied: number }>
  }
}

// ─── Performance ────────────────────────────────────────────────────────────
export interface CostPerWorkItem {
  workItemSourceId: string
  workItemExternalRef: string
  workItemTitle: string | null
  totalCostUsd: number
}

export interface PerformanceSummary {
  sessionCount: number
  avgDurationMinutes: number
  medianDurationMinutes: number
  outcomes: { completed: number; error: number; inactive: number }
  errorRate: number
  avgTurnsPerSession: number
  totalCostUsd: number
  avgCostPerSessionUsd: number
  costPerWorkItem: CostPerWorkItem[]
  planCount: number
  planCompleteRate: number
  stepCompleteRate: number
  failedStepCount: number
  estimateAccuracy: number
}

export const IPC_CHANNELS = {
  appUpdatesGetState: 'appUpdates:getState',
  appUpdatesCheck: 'appUpdates:check',
  appUpdatesDownload: 'appUpdates:download',
  appUpdatesInstall: 'appUpdates:install',
  appUpdatesStateChanged: 'appUpdates:stateChanged',
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  projectsList: 'projects:list',
  projectsGetFocused: 'projects:getFocused',
  projectsSetFocused: 'projects:setFocused',
  projectsPickFolder: 'projects:pickFolder',
  projectsCreate: 'projects:create',
  projectsRename: 'projects:rename',
  projectsUpdate: 'projects:update',
  projectsReveal: 'projects:reveal',
  projectsReorder: 'projects:reorder',
  projectsGetPinnedBranches: 'projects:getPinnedBranches',
  projectsSetPinnedBranches: 'projects:setPinnedBranches',
  projectPick: 'project:pick',
  projectRecentList: 'project:recent:list',
  projectRecentRemove: 'project:recent:remove',
  sessionsList: 'sessions:list',
  sessionsRead: 'sessions:read',
  sessionStart: 'session:start',
  sessionInput: 'session:input',
  sessionInterrupt: 'session:interrupt',
  sessionTerminate: 'session:terminate',
  sessionEvent: 'session:event',
  sessionStatus: 'session:status',
  sessionStats: 'session:stats',
  sessionCreated: 'session:created',
  sessionDeleted: 'session:deleted',
  worktreesList: 'worktrees:list',
  worktreesCreate: 'worktrees:create',
  worktreesRemove: 'worktrees:remove',
  worktreesGitDiffStat: 'worktrees:gitDiffStat',
  rolesList: 'roles:list',
  rolesSave: 'roles:save',
  rolesRemove: 'roles:remove',
  rolesGenerate: 'roles:generate',
  agenciesList: 'agencies:list',
  agenciesSave: 'agencies:save',
  agenciesRemove: 'agencies:remove',
  agenciesStart: 'agencies:start',
  skillsList: 'skills:list',
  skillsInstall: 'skills:install',
  skillsRemove: 'skills:remove',
  skillsAdopt: 'skills:adopt',
  skillsPreview: 'skills:preview',
  skillsGenerate: 'skills:generate',
  skillsSave: 'skills:save',
  commandsList: 'commands:list',
  commandsGenerate: 'commands:generate',
  commandsSave: 'commands:save',
  commandsRemove: 'commands:remove',
  commandsAdopt: 'commands:adopt',
  commandsChanged: 'commands:changed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  resetExecute: 'reset:execute',
  workItemsList: 'workItems:list',
  workItemsGet: 'workItems:get',
  workItemsUpdateStatus: 'workItems:updateStatus',
  workItemsGetTransitions: 'workItems:getTransitions',
  workItemsTransition: 'workItems:transition',
  workItemsCreate: 'workItems:create',
  pluginsConfigGet: 'plugins:config:get',
  pluginsConfigSet: 'plugins:config:set',
  pluginEvent: 'plugin:event',
  pluginsList: 'plugins:list',
  pluginsPickAkpFile: 'plugins:pickAkpFile',
  pluginsPrepareAkpInstall: 'plugins:prepareAkpInstall',
  pluginsConfirmAkpInstall: 'plugins:confirmAkpInstall',
  pluginsCancelAkpInstall: 'plugins:cancelAkpInstall',
  pluginsLoadDev: 'plugins:loadDev',
  pluginsDeveloperModeGet: 'plugins:developerMode:get',
  pluginsDeveloperModeSet: 'plugins:developerMode:set',
  pluginsUnloadDev: 'plugins:unloadDev',
  pluginsUninstall: 'plugins:uninstall',
  pluginsEnable: 'plugins:enable',
  pluginsApprovePermissions: 'plugins:approvePermissions',
  pluginsDisable: 'plugins:disable',
  pluginsCheckUpdates: 'plugins:checkUpdates',
  pluginsUpdate: 'plugins:update',
  pluginsInvoke: 'plugins:invoke',
  pluginsGetRendererBundle: 'plugins:getRendererBundle',
  remotesDetect: 'remotes:detect',
  sessionsListPersisted: 'sessions:listPersisted',
  sessionsGetByLocalId: 'sessions:getByLocalId',
  sessionsResume: 'sessions:resume',
  sessionsDeletePersisted: 'sessions:deletePersisted',
  sessionsTouchPersisted: 'sessions:touchPersisted',
  modelsList: 'models:list',
  modelsRefresh: 'models:refresh',
  modelsChanged: 'models:changed',
  sessionsSetModel: 'sessions:setModel',
  sessionsSetEffort: 'sessions:setEffort',
  sessionsSetPermissionMode: 'sessions:setPermissionMode',
  sessionsDeleteHistorical: 'sessions:deleteHistorical',
  sessionsDeleteAllHistorical: 'sessions:deleteAllHistorical',
  sessionsDeleteAllPersisted: 'sessions:deleteAllPersisted',
  sessionsGetAgents: 'sessions:getAgents',
  sessionsAddAgent: 'sessions:addAgent',
  sessionsListTrackedSdkIds: 'sessions:listTrackedSdkIds',
  sessionsReconnectMcp: 'sessions:reconnectMcp',
  sessionsEditAndRerun: 'sessions:editAndRerun',
  sessionsUndoEditAndRerun: 'sessions:undoEditAndRerun',
  agenciesResume: 'agencies:resume',
  agenciesSetFallbackModel: 'agencies:setFallbackModel',
  agencyScaling: 'agencies:scaling',
  dialogOpenFiles: 'dialog:openFiles',
  gitGetBranch: 'git:getBranch',
  gitGetStatus: 'git:getStatus',
  gitStageFiles: 'git:stageFiles',
  gitUnstageFiles: 'git:unstageFiles',
  gitCommit: 'git:commit',
  gitPush: 'git:push',
  gitPull: 'git:pull',
  gitCreateBranch: 'git:createBranch',
  gitListBranches: 'git:listBranches',
  gitIsRepo: 'git:isRepo',
  gitSwitchBranch: 'git:switchBranch',
  gitSwitchBranchCreate: 'git:switchBranchCreate',
  gitSuggestCommits: 'git:suggestCommits',
  fsListDirectory: 'fs:listDirectory',
  fsWatchStart: 'fs:watchStart',
  fsWatchStop: 'fs:watchStop',
  gitStatusChanged: 'git:statusChanged',
  gitBranchChanged: 'git:branchChanged',
  fsChanged: 'fs:changed',
  plansList: 'plans:list',
  plansGet: 'plans:get',
  plansCreate: 'plans:create',
  plansUpdate: 'plans:update',
  plansDelete: 'plans:delete',
  planUpdated: 'plan:updated',
  costsGetDailySummary: 'costs:getDailySummary',
  costsGetDailySummaryByProject: 'costs:getDailySummaryByProject',
  costsAddLegacy: 'costs:addLegacy',
  pricingRefresh: 'pricing:refresh',
  pricingGetTable: 'pricing:getTable',
  draftsGet: 'drafts:get',
  draftsSet: 'drafts:set',
  draftsClear: 'drafts:clear',
  statsGetAll: 'stats:getAll',
  statsUpsert: 'stats:upsert',
  statsImportLegacy: 'stats:importLegacy',
  devRunMigrations: 'dev:runMigrations',
  notificationsTrigger: 'notifications:trigger',
  notificationsNavigate: 'notifications:navigate',
  terminalCreate: 'terminal:create',
  terminalAttach: 'terminal:attach',
  terminalSendInput: 'terminal:sendInput',
  terminalResize: 'terminal:resize',
  terminalDestroy: 'terminal:destroy',
  terminalKill: 'terminal:kill',
  terminalData: 'terminal:data',
  harnessListAdapters: 'harness:list',
  harnessGetActive: 'harness:getActive',
  harnessSetActive: 'harness:setActive',
  harnessAuth: 'harness:auth',
  harnessConfigGet: 'harness:config:get',
  harnessConfigSet: 'harness:config:set',
  harnessConfigSecretSet: 'harness:config:secret:set',
  harnessConfigSecretDelete: 'harness:config:secret:delete',
  harnessAuthAction: 'harness:auth:action',
  mobileGenerateKey: 'mobile:generateKey',
  mobileGetLocalIp: 'mobile:getLocalIp',
  performanceGetSummary: 'performance:getSummary',
} as const
