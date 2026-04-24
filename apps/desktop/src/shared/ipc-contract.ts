// Shared between main, preload, and renderer. Pure types/constants only — no
// runtime imports from Electron or Node.

import type { WorkItem, WorkItemStatus } from '@orchestral/sdk'
export type { WorkItem, WorkItemStatus }

// ─── Projects ───────────────────────────────────────────────────────────────

export interface RecentProject {
  path: string
  name: string
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
  | 'completed'
  | 'cancelled'
  | 'error'

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
    cancel: (sessionId: string) => Promise<void>
    onEvent: (callback: (event: LiveSessionEvent) => void) => () => void
    onStatus: (
      callback: (update: LiveSessionStatusUpdate) => void,
    ) => () => void
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
  }
  commands: {
    list: (projectPath: string) => Promise<SlashCommand[]>
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
  workItems: {
    list: () => Promise<WorkItem[]>
    get: (id: string) => Promise<WorkItem | undefined>
    updateStatus: (id: string, status: WorkItemStatus) => Promise<void>
  }
}

export const IPC_CHANNELS = {
  projectPick: 'project:pick',
  projectRecentList: 'project:recent:list',
  projectRecentRemove: 'project:recent:remove',
  sessionsList: 'sessions:list',
  sessionsRead: 'sessions:read',
  sessionStart: 'session:start',
  sessionInput: 'session:input',
  sessionCancel: 'session:cancel',
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
  commandsList: 'commands:list',
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
} as const
