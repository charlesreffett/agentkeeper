// Shared between main, preload, and renderer. Pure types/constants only — no
// runtime imports from Electron or Node.

import type { IssueTransition, WorkItem, WorkItemCreateParams, WorkItemStatus } from '@agentkeeper/sdk'
export type { IssueTransition, WorkItem, WorkItemCreateParams, WorkItemStatus }
import type {
  CheckRun,
  CheckState,
  CreatePRParams,
  GitHubConfig,
  MergeMethod,
  PRComment,
  PRDetail,
  PRFilters,
  PRReview,
  PRState,
  PRSummary,
  ReviewDecision,
  ReviewEvent,
} from './github-types'
export type {
  CheckRun,
  CheckState,
  CreatePRParams,
  GitHubConfig,
  MergeMethod,
  PRComment,
  PRDetail,
  PRFilters,
  PRReview,
  PRState,
  PRSummary,
  ReviewDecision,
  ReviewEvent,
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

// ─── Projects ───────────────────────────────────────────────────────────────

export interface RecentProject {
  path: string
  name: string
  repo: string | null
  lastOpenedAt: number
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
  projectPath: string
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
  | 'terminated'
  | 'error'

export interface Session {
  localId: string
  sdkSessionId: string | null
  projectPath: string
  worktreePath: string | null
  branch: string | null
  model: string | null
  effort: RoleEffort | null
  permissionMode: PermissionMode | null
  initialPrompt: string
  roleName: string | null
  roleId: string | null
  agencyInstanceId: string | null
  agencyName: string | null
  agencyId: string | null
  agencyScope: AgencyScope | null
  startedAt: number
  lastActivityAt: number
  status: LiveSessionStatus
  workItemKey: string | null
  workItemTitle: string | null
  title: string | null
}

export interface StartSessionParams {
  /**
   * Caller-supplied id so the renderer can add the session to its store
   * BEFORE main starts broadcasting status/event messages. If omitted,
   * main generates one — the value returned from start() is authoritative.
   */
  localId?: string
  /** The logical project the session belongs to (the main repo root). */
  projectPath: string
  /**
   * Actual cwd for the SDK subprocess. Defaults to projectPath. Set this
   * to a worktree path when a session should run in a separate branch/dir.
   */
  worktreePath?: string
  initialPrompt: string
  model?: string
  effort?: RoleEffort
  permissionMode?: PermissionMode
  /** Role-derived options — appended to the default Claude Code preset. */
  systemPromptAppend?: string
  allowedTools?: string[]
  /** Membership in an agency run, if applicable — tagged by the orchestrator. */
  agencyInstanceId?: string
  roleId?: string
  /** 1-based instance index within the role. */
  roleInstanceIndex?: number
  /** Agency definition id — persisted so resumeAgency can reload the agency config. */
  agencyId?: string
  /** Scope of the agency definition. */
  agencyScope?: AgencyScope
  /** Work item to attach as context for the session. */
  workItemId?: string
  /** Display key for the linked work item, e.g. "CORE-482", "MOB-631". */
  workItemKey?: string | null
  /** Human-readable title of the linked work item. */
  workItemTitle?: string | null
  /** Resume an existing SDK session by its session_id. When set, the session
   *  starts in 'idle' and no initial prompt is pushed to the queue. */
  resumeSdkSessionId?: string
  /** Attachments to include with the initial user message. */
  initialAttachments?: Attachment[]
  /** Role display name — persisted so the registry can show it without a role lookup. */
  roleName?: string
  /** Agency display name — persisted for the same reason. */
  agencyName?: string
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
  path: string
  name: string
  description: string
  body: string
}

// ─── Commands ────────────────────────────────────────────────────────────────

export interface SlashCommand {
  id: string
  scope: 'project' | 'global'
  path: string
  name: string
  body: string
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
  model: string | null
  effort: RoleEffort | null
  allowedTools: string[] | null
  systemPrompt: string
}

export type RoleDraft = Omit<Role, 'scope' | 'path'>

export interface RolesGenerateResult {
  id: string
  name: string
  description: string
  allowedTools: string[] | null
  systemPrompt: string
}

// ─── Agencies ───────────────────────────────────────────────────────────────

export type AgencyScope = 'project' | 'global'

export interface RoleSlot {
  roleId: string
  count?: number   // static — always this many (undefined = 1)
  min?: number     // dynamic floor
  max?: number     // dynamic ceiling
}

export interface Agency {
  id: string
  scope: AgencyScope
  path: string
  name: string
  description: string
  roles: RoleSlot[]
  flows: Array<[string, string]>
  entryPoints: string[]
  notes: string
}

export type AgencyDraft = Omit<Agency, 'scope' | 'path'>

/** Parameters to launch an agency: creates one shared worktree (optional)
 *  and spawns one session per role. Entry-point roles receive initialPrompt. */
export interface StartAgencyParams {
  projectPath: string
  agencyId: string
  agencyScope: AgencyScope
  initialPrompt: string
  useWorktree: boolean
  branch?: string
  model?: string
  workItemKey?: string | null
  workItemTitle?: string | null
}

export interface AgencyInstanceSession {
  localId: string
  roleId: string        // base role id, e.g. "developer"
  instanceId: string    // qualified: "developer-1", "developer-2", etc.
  instanceIndex: number // 1-based
  roleName: string
  isEntryPoint: boolean
  isOverflow: boolean   // true if spawned above the min floor
}

export interface AgencyInstance {
  instanceId: string
  agencyId: string
  agencyName: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  sessions: AgencyInstanceSession[]
}

/** SDK message forwarded to renderer as-is (plain object, structured-clone-safe). */
export interface LiveSessionEvent {
  sessionId: string
  message: unknown
}

export interface LiveSessionStatusUpdate {
  sessionId: string
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
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    totalCostUsd: number
  }
}

// ─── Settings & secrets ─────────────────────────────────────────────────────

export interface AppSettings {
  defaultModel: string
  defaultEffort: RoleEffort
  /** When true, new sessions default to creating an isolated git worktree. Default false. */
  defaultUseWorktree: boolean
  /** When true: Enter sends, modifier+Enter inserts a newline. Default false. */
  enterToSend: boolean
  /** Which modifier triggers send. 'auto' = platform default (meta on Mac, ctrl elsewhere). */
  sendModifier: 'auto' | 'meta' | 'ctrl' | 'alt' | 'shift'
  /** Days of inactivity before a persisted session is auto-pruned. null = never expire. */
  sessionExpiryDays: number | null
  theme: 'light' | 'dark'
}

export type SecretKeyName = 'anthropicApiKey'

export type ClaudeAuthType = 'api-key' | 'cli'

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

export type PlanStatus = 'planned' | 'drafting' | 'running' | 'complete'
export type PlanStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'skipped' | 'replanning'
export type PlanAgentType = 'explorer' | 'main' | 'qa' | 'doc' | string

export interface PlanStep {
  id: number
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
}

export interface Plan {
  filename: string
  filePath: string
  /** Short identifier shown as PL-01, PL-02 etc. Derived from list position if absent. */
  planRef?: string
  title: string
  /** The original prompt that triggered planning. */
  prompt?: string
  externalRef: string
  workItemId: string
  status: PlanStatus
  estimatedMinutes: number
  createdAt: string
  updatedAt: string
  sessionIds: string[]
  steps: PlanStep[]
}

// ─── Session stats ───────────────────────────────────────────────────────────

export interface SessionStatRow {
  sessionLocalId: string
  totalTokens: number
  totalCostUsd: number
  turnCount: number
  inProgressTokens: number
}

// ─── Cost ledger ─────────────────────────────────────────────────────────────

export interface DayTotal {
  date: string     // YYYY-MM-DD
  costUsd: number
  tokens: number
}

export interface PricingMeta {
  source: 'bundled' | 'litellm-cache'
  fetchedAt: string | null
  modelCount: number
}

export interface LegacyDayEntry {
  date: string
  tokens: number
  costUsd: number
}

// ─── IPC API exposed to renderer as window.agentkeeper ──────────────────────

export interface AgentKeeperApi {
  projects: {
    add: (path: string) => Promise<RecentProject>
    remove: (path: string) => Promise<void>
    rename: (oldPath: string, newName: string, renameDir: boolean) => Promise<RecentProject>
    list: () => Promise<RecentProject[]>
    getFocused: () => Promise<RecentProject | null>
    setFocused: (path: string | null) => Promise<void>
    pickFolder: () => Promise<string | null>
  }
  project: {
    pick: () => Promise<RecentProject | null>
    recent: {
      list: () => Promise<RecentProject[]>
      remove: (path: string) => Promise<void>
    }
  }
  sessions: {
    list: (projectPath: string) => Promise<SessionSummary[]>
    read: (
      projectPath: string,
      sessionId: string,
    ) => Promise<SessionTranscript | null>
    start: (params: StartSessionParams) => Promise<string>
    sendInput: (sessionId: string, text: string, attachments?: Attachment[]) => Promise<void>
    interrupt: (sessionId: string) => Promise<void>
    terminate: (sessionId: string) => Promise<void>
    onEvent: (callback: (event: LiveSessionEvent) => void) => () => void
    onStatus: (
      callback: (update: LiveSessionStatusUpdate) => void,
    ) => () => void
    onStats: (callback: (stats: LiveSessionStats) => void) => () => void
    listPersisted: (projectPath: string) => Promise<Session[]>
    resume: (localId: string) => Promise<string>
    deletePersisted: (localId: string) => Promise<void>
    touchPersisted: (localId: string) => Promise<void>
    setModel: (localId: string, model: string) => Promise<void>
    setEffort: (localId: string, effort: RoleEffort) => Promise<void>
    setPermissionMode: (localId: string, mode: PermissionMode) => Promise<void>
    deleteHistorical: (projectPath: string, sessionId: string) => Promise<void>
    deleteAllHistorical: (projectPath: string) => Promise<void>
    deleteAllPersisted: (projectPath: string) => Promise<void>
  }
  worktrees: {
    list: (projectPath: string) => Promise<WorktreeInfo[]>
    create: (projectPath: string, branchRequest: string) => Promise<WorktreeInfo>
    remove: (projectPath: string, worktreePath: string) => Promise<void>
    gitDiffStat: (worktreePath: string, baseBranch?: string) => Promise<GitDiffStatFile[]>
  }
  roles: {
    list: (projectPath: string) => Promise<Role[]>
    save: (
      scope: RoleScope,
      projectPath: string,
      role: RoleDraft,
    ) => Promise<Role>
    remove: (scope: RoleScope, projectPath: string, id: string) => Promise<void>
    generate: (prompt: string) => Promise<RolesGenerateResult>
  }
  agencies: {
    list: (projectPath: string) => Promise<Agency[]>
    save: (
      scope: AgencyScope,
      projectPath: string,
      agency: AgencyDraft,
    ) => Promise<Agency>
    remove: (
      scope: AgencyScope,
      projectPath: string,
      id: string,
    ) => Promise<void>
    start: (params: StartAgencyParams) => Promise<AgencyInstance>
    resume: (instanceId: string) => Promise<AgencyInstance>
  }
  skills: {
    list: (projectPath: string) => Promise<Skill[]>
    install: (
      projectPath: string,
      source: string,
      scope: 'project' | 'global',
      skillIds?: string[],
    ) => Promise<void>
    remove: (skill: Skill) => Promise<void>
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
    ) => Promise<SlashCommand>
    remove: (cmd: SlashCommand) => Promise<void>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (partial: Partial<AppSettings>) => Promise<AppSettings>
  }
  auth: {
    status: () => Promise<ClaudeAuthType>
  }
  secrets: {
    has: (key: SecretKeyName) => Promise<boolean>
    set: (key: SecretKeyName, value: string) => Promise<void>
    delete: (key: SecretKeyName) => Promise<void>
  }
  reset: {
    execute: (request: ResetRequest) => Promise<ResetResult>
  }
  plugins: {
    getConfig: (pluginId: string) => Promise<unknown>
    setConfig: (pluginId: string, config: unknown) => Promise<void>
    onEvent: (handler: (event: string, payload: unknown) => void) => () => void
  }
  workItems: {
    list: () => Promise<WorkItem[]>
    get: (id: string) => Promise<WorkItem | undefined>
    updateStatus: (id: string, status: WorkItemStatus) => Promise<void>
    getTransitions: (id: string) => Promise<IssueTransition[]>
    transition: (id: string, name: string) => Promise<void>
    create: (params: WorkItemCreateParams) => Promise<WorkItem>
  }
  remotes: {
    detect: (projectPath: string) => Promise<RemoteSource[]>
  }
  github: {
    getConfig: () => Promise<GitHubConfig>
    setConfig: (config: GitHubConfig) => Promise<void>
    listPRs: (filters: PRFilters) => Promise<PRSummary[]>
    getPR: (repo: string, number: number) => Promise<PRDetail>
    getPRDiff: (repo: string, number: number) => Promise<string>
    getPRChecks: (repo: string, number: number) => Promise<CheckRun[]>
    getPRComments: (repo: string, number: number) => Promise<PRComment[]>
    addComment: (repo: string, number: number, body: string) => Promise<void>
    submitReview: (repo: string, number: number, event: ReviewEvent, body: string) => Promise<void>
    mergePR: (repo: string, number: number, method: MergeMethod) => Promise<void>
    createPR: (params: CreatePRParams) => Promise<PRSummary>
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
    suggestCommits: (projectPath: string) => Promise<CommitSuggestion>
  }
  fs: {
    listDirectory: (dirPath: string) => Promise<FsEntry[]>
  }
  plans: {
    list: (projectPath: string) => Promise<Plan[]>
    get: (projectPath: string, filename: string) => Promise<Plan | null>
  }
  costs: {
    getDailySummary: () => Promise<DayTotal[]>
    addLegacy: (entries: Array<LegacyDayEntry>) => Promise<void>
  }
  pricing: {
    getMeta: () => Promise<PricingMeta>
    refresh: () => Promise<PricingMeta>
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
}

export const IPC_CHANNELS = {
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  projectsList: 'projects:list',
  projectsGetFocused: 'projects:getFocused',
  projectsSetFocused: 'projects:setFocused',
  projectsPickFolder: 'projects:pickFolder',
  projectsRename: 'projects:rename',
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
  skillsPreview: 'skills:preview',
  skillsGenerate: 'skills:generate',
  skillsSave: 'skills:save',
  commandsList: 'commands:list',
  commandsGenerate: 'commands:generate',
  commandsSave: 'commands:save',
  commandsRemove: 'commands:remove',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  authStatus: 'auth:status',
  secretsHas: 'secrets:has',
  secretsSet: 'secrets:set',
  secretsDelete: 'secrets:delete',
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
  githubConfigGet: 'github:config:get',
  githubConfigSet: 'github:config:set',
  githubListPRs: 'github:prs:list',
  githubGetPR: 'github:prs:get',
  githubGetPRDiff: 'github:prs:diff',
  githubGetPRChecks: 'github:prs:checks',
  githubGetPRComments: 'github:prs:comments',
  githubAddComment: 'github:prs:comment',
  githubSubmitReview: 'github:prs:review',
  githubMergePR: 'github:prs:merge',
  githubCreatePR: 'github:prs:create',
  remotesDetect: 'remotes:detect',
  sessionsListPersisted: 'sessions:listPersisted',
  sessionsResume: 'sessions:resume',
  sessionsDeletePersisted: 'sessions:deletePersisted',
  sessionsTouchPersisted: 'sessions:touchPersisted',
  sessionsSetModel: 'sessions:setModel',
  sessionsSetEffort: 'sessions:setEffort',
  sessionsSetPermissionMode: 'sessions:setPermissionMode',
  sessionsDeleteHistorical: 'sessions:deleteHistorical',
  sessionsDeleteAllHistorical: 'sessions:deleteAllHistorical',
  sessionsDeleteAllPersisted: 'sessions:deleteAllPersisted',
  agenciesResume: 'agencies:resume',
  dialogOpenFiles: 'dialog:openFiles',
  gitGetBranch: 'git:getBranch',
  gitGetStatus: 'git:getStatus',
  gitStageFiles: 'git:stageFiles',
  gitUnstageFiles: 'git:unstageFiles',
  gitCommit: 'git:commit',
  gitPush: 'git:push',
  gitSuggestCommits: 'git:suggestCommits',
  fsListDirectory: 'fs:listDirectory',
  plansList: 'plans:list',
  plansGet: 'plans:get',
  costsGetDailySummary: 'costs:getDailySummary',
  costsAddLegacy: 'costs:addLegacy',
  pricingRefresh: 'pricing:refresh',
  pricingGetMeta: 'pricing:getMeta',
  draftsGet: 'drafts:get',
  draftsSet: 'drafts:set',
  draftsClear: 'drafts:clear',
  statsGetAll: 'stats:getAll',
  statsUpsert: 'stats:upsert',
  statsImportLegacy: 'stats:importLegacy',
} as const
