// Shared between main, preload, and renderer. Pure types/constants only — no
// runtime imports from Electron or Node.

import type { IssueTransition, WorkItem, WorkItemCreateParams, WorkItemStatus } from '@orchestral/sdk'
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

// ─── Remote sources ─────────────────────────────────────────────────────────

export interface RemoteSource {
  type: 'github' | 'gitlab' | 'bitbucket'
  owner: string
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

export type LiveSessionStatus =
  | 'starting'
  | 'running'
  | 'idle'
  | 'suspended'
  | 'completed'
  | 'terminated'
  | 'error'

export interface PersistedSession {
  localId: string
  sdkSessionId: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  model: string | null
  effort: string | null
  initialPrompt: string
  roleName: string | null
  roleId: string | null
  agencyInstanceId: string | null
  agencyName: string | null
  startedAt: number
  lastActivityAt: number
  status: LiveSessionStatus
}

export interface PersistedAgency {
  instanceId: string
  agencyId: string
  agencyScope: AgencyScope
  agencyName: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  startedAt: number
  lastActivityAt: number
  /** roleId → sdkSessionId, populated as sessions initialise */
  roleSessionMap: Record<string, string>
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
  /** Role-derived options — appended to the default Claude Code preset. */
  systemPromptAppend?: string
  allowedTools?: string[]
  /** Membership in an agency run, if applicable — tagged by the orchestrator. */
  agencyInstanceId?: string
  roleId?: string
  /** Work item to attach as context for the session. */
  workItemId?: string
  /** Resume an existing SDK session by its session_id. When set, the session
   *  starts in 'idle' and no initial prompt is pushed to the queue. */
  resumeSdkSessionId?: string
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
  allowedPeers: string[] | null
  systemPrompt: string
}

export type RoleDraft = Omit<Role, 'scope' | 'path'>

// ─── Agencies ───────────────────────────────────────────────────────────────

export type AgencyScope = 'project' | 'global'

export interface Agency {
  id: string
  scope: AgencyScope
  path: string
  name: string
  description: string
  roles: string[]
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
}

export interface AgencyInstanceSession {
  localId: string
  roleId: string
  roleName: string
  isEntryPoint: boolean
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
  status: LiveSessionStatus
  sdkSessionId?: string
  error?: string
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
}

export type SecretKeyName = 'anthropicApiKey'

// ─── Factory reset ──────────────────────────────────────────────────────────

export interface ResetRequest {
  /** settings.json and all stored secrets (keychain API key, etc.). */
  appSettings: boolean
  /** `~/.orchestral/` role and agency definitions. */
  globalDefinitions: boolean
  /** `<projectPath>/.orchestral/` — set to null to skip. */
  projectDefinitions: { projectPath: string } | null
}

export interface ResetResult {
  appSettingsCleared: boolean
  globalDefinitionsCleared: boolean
  projectDefinitionsCleared: boolean
  errors: string[]
}

// ─── IPC API exposed to renderer as window.orchestral ───────────────────────

export interface OrchestralApi {
  projects: {
    add: (path: string) => Promise<RecentProject>
    remove: (path: string) => Promise<void>
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
    sendInput: (sessionId: string, text: string) => Promise<void>
    interrupt: (sessionId: string) => Promise<void>
    terminate: (sessionId: string) => Promise<void>
    onEvent: (callback: (event: LiveSessionEvent) => void) => () => void
    onStatus: (
      callback: (update: LiveSessionStatusUpdate) => void,
    ) => () => void
    listPersisted: (projectPath: string) => Promise<PersistedSession[]>
    resume: (localId: string) => Promise<string>
    deletePersisted: (localId: string) => Promise<void>
    touchPersisted: (localId: string) => Promise<void>
  }
  worktrees: {
    list: (projectPath: string) => Promise<WorktreeInfo[]>
    create: (projectPath: string, branchRequest: string) => Promise<WorktreeInfo>
    remove: (projectPath: string, worktreePath: string) => Promise<void>
  }
  roles: {
    list: (projectPath: string) => Promise<Role[]>
    save: (
      scope: RoleScope,
      projectPath: string,
      role: RoleDraft,
    ) => Promise<Role>
    remove: (scope: RoleScope, projectPath: string, id: string) => Promise<void>
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
    listPersisted: (projectPath: string) => Promise<PersistedAgency[]>
    resume: (instanceId: string) => Promise<AgencyInstance>
    deletePersisted: (instanceId: string) => Promise<void>
    touchPersisted: (instanceId: string) => Promise<void>
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
}

export const IPC_CHANNELS = {
  projectsAdd: 'projects:add',
  projectsRemove: 'projects:remove',
  projectsList: 'projects:list',
  projectsGetFocused: 'projects:getFocused',
  projectsSetFocused: 'projects:setFocused',
  projectsPickFolder: 'projects:pickFolder',
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
  worktreesList: 'worktrees:list',
  worktreesCreate: 'worktrees:create',
  worktreesRemove: 'worktrees:remove',
  rolesList: 'roles:list',
  rolesSave: 'roles:save',
  rolesRemove: 'roles:remove',
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
  agenciesListPersisted: 'agencies:listPersisted',
  agenciesResume: 'agencies:resume',
  agenciesDeletePersisted: 'agencies:deletePersisted',
  agenciesTouchPersisted: 'agencies:touchPersisted',
} as const
