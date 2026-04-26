import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type AgencyDraft,
  type AgencyScope,
  type AppSettings,
  type CreatePRParams,
  type GitHubConfig,
  type IssueTransition,
  type LiveSessionEvent,
  type LiveSessionStatusUpdate,
  type MergeMethod,
  type OrchestralApi,
  type PRFilters,
  type PersistedAgency,
  type PersistedSession,
  type ResetRequest,
  type ReviewEvent,
  type RoleDraft,
  type RoleScope,
  type SecretKeyName,
  type Skill,
  type SkillPreview,
  type SlashCommand,
  type StartAgencyParams,
  type StartSessionParams,
  type WorkItemStatus,
} from '../shared/ipc-contract'

/**
 * JSON round-trip to strip Vue reactive Proxies, class instances, and
 * anything else that Electron's structured-clone IPC refuses. Primitives
 * pass through unchanged. Applied uniformly in invoke() below so call
 * sites never have to think about it.
 */
function toPlain<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

function describeArg(a: unknown): string {
  if (a === null) return 'null'
  if (a === undefined) return 'undefined'
  if (Array.isArray(a)) return `array(${a.length})`
  if (typeof a === 'object') {
    const ctor = (a as object).constructor?.name ?? 'object'
    const keys = Object.keys(a as object).slice(0, 6).join(',')
    return `${ctor}{${keys}}`
  }
  return typeof a
}

function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const plainArgs = args.map(toPlain)
  // Fast-fail: verify the payload actually crosses structured-clone BEFORE
  // ipcRenderer.invoke does it, so the error surfaces with our own context
  // instead of Electron's opaque "An object could not be cloned."
  try {
    structuredClone(plainArgs)
  } catch (err) {
    const shape = plainArgs.map((a, i) => `${i}:${describeArg(a)}`).join(' ')
    const reason = err instanceof Error ? err.message : String(err)
    console.error('[preload] IPC clone-check failed', {
      channel,
      shape,
      reason,
      rawArgs: args,
      plainArgs,
    })
    throw new Error(
      `IPC ${channel}: args not structured-clone safe after toPlain [${shape}] — ${reason}`,
    )
  }
  return ipcRenderer.invoke(channel, ...plainArgs)
}

function onChannel<P>(
  channel: string,
  callback: (payload: P) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, payload: P) => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api: OrchestralApi = {
  projects: {
    add: (projectPath: string) =>
      invoke(IPC_CHANNELS.projectsAdd, projectPath) as Promise<never>,
    remove: (projectPath: string) =>
      invoke(IPC_CHANNELS.projectsRemove, projectPath) as Promise<void>,
    list: () => invoke(IPC_CHANNELS.projectsList) as Promise<never>,
    getFocused: () => invoke(IPC_CHANNELS.projectsGetFocused) as Promise<never>,
    setFocused: (projectPath: string | null) =>
      invoke(IPC_CHANNELS.projectsSetFocused, projectPath) as Promise<void>,
    pickFolder: () => invoke(IPC_CHANNELS.projectsPickFolder) as Promise<string | null>,
  },
  project: {
    pick: () => invoke(IPC_CHANNELS.projectPick) as Promise<never>,
    recent: {
      list: () => invoke(IPC_CHANNELS.projectRecentList) as Promise<never>,
      remove: (path: string) =>
        invoke(IPC_CHANNELS.projectRecentRemove, path) as Promise<void>,
    },
  },
  sessions: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.sessionsList, projectPath) as Promise<never>,
    read: (projectPath: string, sessionId: string) =>
      invoke(IPC_CHANNELS.sessionsRead, projectPath, sessionId) as Promise<never>,
    start: (params: StartSessionParams) =>
      invoke(IPC_CHANNELS.sessionStart, params) as Promise<string>,
    sendInput: (sessionId: string, text: string) =>
      invoke(IPC_CHANNELS.sessionInput, sessionId, text) as Promise<void>,
    cancel: (sessionId: string) =>
      invoke(IPC_CHANNELS.sessionCancel, sessionId) as Promise<void>,
    onEvent: (cb) => onChannel<LiveSessionEvent>(IPC_CHANNELS.sessionEvent, cb),
    onStatus: (cb) =>
      onChannel<LiveSessionStatusUpdate>(IPC_CHANNELS.sessionStatus, cb),
    listPersisted: (projectPath: string) =>
      invoke(IPC_CHANNELS.sessionsListPersisted, projectPath) as Promise<PersistedSession[]>,
    resume: (localId: string) =>
      invoke(IPC_CHANNELS.sessionsResume, localId) as Promise<string>,
    deletePersisted: (localId: string) =>
      invoke(IPC_CHANNELS.sessionsDeletePersisted, localId) as Promise<void>,
    touchPersisted: (localId: string) =>
      invoke(IPC_CHANNELS.sessionsTouchPersisted, localId) as Promise<void>,
  },
  worktrees: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.worktreesList, projectPath) as Promise<never>,
    create: (projectPath: string, branchRequest: string) =>
      invoke(IPC_CHANNELS.worktreesCreate, projectPath, branchRequest) as Promise<never>,
    remove: (projectPath: string, worktreePath: string) =>
      invoke(IPC_CHANNELS.worktreesRemove, projectPath, worktreePath) as Promise<void>,
  },
  roles: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.rolesList, projectPath) as Promise<never>,
    save: (scope: RoleScope, projectPath: string, role: RoleDraft) =>
      invoke(IPC_CHANNELS.rolesSave, scope, projectPath, role) as Promise<never>,
    remove: (scope: RoleScope, projectPath: string, id: string) =>
      invoke(IPC_CHANNELS.rolesRemove, scope, projectPath, id) as Promise<void>,
  },
  agencies: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.agenciesList, projectPath) as Promise<never>,
    save: (scope: AgencyScope, projectPath: string, agency: AgencyDraft) =>
      invoke(IPC_CHANNELS.agenciesSave, scope, projectPath, agency) as Promise<never>,
    remove: (scope: AgencyScope, projectPath: string, id: string) =>
      invoke(IPC_CHANNELS.agenciesRemove, scope, projectPath, id) as Promise<void>,
    start: (params: StartAgencyParams) =>
      invoke(IPC_CHANNELS.agenciesStart, params) as Promise<never>,
    listPersisted: (projectPath: string) =>
      invoke(IPC_CHANNELS.agenciesListPersisted, projectPath) as Promise<PersistedAgency[]>,
    resume: (instanceId: string) =>
      invoke(IPC_CHANNELS.agenciesResume, instanceId) as Promise<never>,
    deletePersisted: (instanceId: string) =>
      invoke(IPC_CHANNELS.agenciesDeletePersisted, instanceId) as Promise<void>,
    touchPersisted: (instanceId: string) =>
      invoke(IPC_CHANNELS.agenciesTouchPersisted, instanceId) as Promise<void>,
  },
  skills: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.skillsList, projectPath) as Promise<never>,
    install: (
      projectPath: string,
      source: string,
      scope: 'project' | 'global',
      skillIds?: string[],
    ) =>
      invoke(
        IPC_CHANNELS.skillsInstall,
        projectPath,
        source,
        scope,
        skillIds,
      ) as Promise<void>,
    remove: (skill: Skill) =>
      invoke(IPC_CHANNELS.skillsRemove, skill) as Promise<void>,
    preview: (projectPath: string, source: string): Promise<SkillPreview[]> =>
      invoke(IPC_CHANNELS.skillsPreview, projectPath, source) as Promise<
        SkillPreview[]
      >,
  },
  commands: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.commandsList, projectPath) as Promise<never>,
    save: (
      scope: 'project' | 'global',
      projectPath: string,
      id: string,
      body: string,
    ) =>
      invoke(
        IPC_CHANNELS.commandsSave,
        scope,
        projectPath,
        id,
        body,
      ) as Promise<never>,
    remove: (cmd: SlashCommand) =>
      invoke(IPC_CHANNELS.commandsRemove, cmd) as Promise<void>,
  },
  settings: {
    get: () => invoke(IPC_CHANNELS.settingsGet) as Promise<never>,
    set: (partial: Partial<AppSettings>) =>
      invoke(IPC_CHANNELS.settingsSet, partial) as Promise<never>,
  },
  secrets: {
    has: (key: SecretKeyName) =>
      invoke(IPC_CHANNELS.secretsHas, key) as Promise<boolean>,
    set: (key: SecretKeyName, value: string) =>
      invoke(IPC_CHANNELS.secretsSet, key, value) as Promise<void>,
    delete: (key: SecretKeyName) =>
      invoke(IPC_CHANNELS.secretsDelete, key) as Promise<void>,
  },
  reset: {
    execute: (request: ResetRequest) =>
      invoke(IPC_CHANNELS.resetExecute, request) as Promise<never>,
  },
  plugins: {
    getConfig: (pluginId: string) =>
      invoke(IPC_CHANNELS.pluginsConfigGet, pluginId) as Promise<unknown>,
    setConfig: (pluginId: string, config: unknown) =>
      invoke(IPC_CHANNELS.pluginsConfigSet, pluginId, config) as Promise<void>,
    onEvent: (handler: (event: string, payload: unknown) => void): () => void => {
      const listener = (_: IpcRendererEvent, event: string, payload: unknown) =>
        handler(event, payload)
      ipcRenderer.on(IPC_CHANNELS.pluginEvent, listener)
      return () => ipcRenderer.off(IPC_CHANNELS.pluginEvent, listener)
    },
  },
  workItems: {
    list: () => invoke(IPC_CHANNELS.workItemsList) as Promise<never>,
    get: (id: string) => invoke(IPC_CHANNELS.workItemsGet, id) as Promise<never>,
    updateStatus: (id: string, status: WorkItemStatus) =>
      invoke(IPC_CHANNELS.workItemsUpdateStatus, id, status) as Promise<void>,
    getTransitions: (id: string) =>
      invoke(IPC_CHANNELS.workItemsGetTransitions, id) as Promise<IssueTransition[]>,
    transition: (id: string, name: string) =>
      invoke(IPC_CHANNELS.workItemsTransition, id, name) as Promise<void>,
  },
  github: {
    getConfig: () =>
      invoke(IPC_CHANNELS.githubConfigGet) as Promise<GitHubConfig>,
    setConfig: (config: GitHubConfig) =>
      invoke(IPC_CHANNELS.githubConfigSet, config) as Promise<void>,
    listPRs: (filters: PRFilters) =>
      invoke(IPC_CHANNELS.githubListPRs, filters) as Promise<never>,
    getPR: (repo: string, number: number) =>
      invoke(IPC_CHANNELS.githubGetPR, repo, number) as Promise<never>,
    getPRDiff: (repo: string, number: number) =>
      invoke(IPC_CHANNELS.githubGetPRDiff, repo, number) as Promise<string>,
    getPRChecks: (repo: string, number: number) =>
      invoke(IPC_CHANNELS.githubGetPRChecks, repo, number) as Promise<never>,
    getPRComments: (repo: string, number: number) =>
      invoke(IPC_CHANNELS.githubGetPRComments, repo, number) as Promise<never>,
    addComment: (repo: string, number: number, body: string) =>
      invoke(IPC_CHANNELS.githubAddComment, repo, number, body) as Promise<void>,
    submitReview: (repo: string, number: number, event: ReviewEvent, body: string) =>
      invoke(IPC_CHANNELS.githubSubmitReview, repo, number, event, body) as Promise<void>,
    mergePR: (repo: string, number: number, method: MergeMethod) =>
      invoke(IPC_CHANNELS.githubMergePR, repo, number, method) as Promise<void>,
    createPR: (params: CreatePRParams) =>
      invoke(IPC_CHANNELS.githubCreatePR, params) as Promise<never>,
  },
}

contextBridge.exposeInMainWorld('orchestral', api)
