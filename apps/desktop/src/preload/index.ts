import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_CHANNELS,
  type AddAgentParams,
  type Agent,
  type AgencyDraft,
  type GitDiffStatFile,
  type AgencyScope,
  type AppSettings,
  type Attachment,
  type ClaudeAuthType,
  type CreatePRParams,
  type DayTotal,
  type DraftRecord,
  type LegacyDayEntry,
  type FsEntry,
  type FsChangedEvent,
  type GitHubConfig,
  type GitStatusChangedEvent,
  type CommitSuggestion,
  type GitStatus,
  type IssueTransition,
  type LiveSessionEvent,
  type LiveSessionStats,
  type LiveSessionStatusUpdate,
  type MergeMethod,
  type AgentKeeperApi,
  type Plan,
  type PlansCreateInput,
  type PlansUpdateInput,
  type PRFilters,
  type Session,
  type PermissionMode,
  type ModelPricing,
  type RemoteSource,
  type ResetRequest,
  type ReviewEvent,
  type RoleDraft,
  type RoleEffort,
  type RoleScope,
  type RolesGenerateResult,
  type SecretKeyName,
  type SessionStatRow,
  type Skill,
  type SkillPreview,
  type SlashCommand,
  type StartAgencyParams,
  type StartSessionParams,
  type WorkItemCreateParams,
  type WorkItemStatus,
  type JiraProject,
  type PluginRecord,
  type UpdateAvailable,
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

const api: AgentKeeperApi = {
  auth: {
    status: () => invoke(IPC_CHANNELS.authStatus) as Promise<ClaudeAuthType>,
  },
  projects: {
    add: (projectPath: string) =>
      invoke(IPC_CHANNELS.projectsAdd, projectPath) as Promise<never>,
    remove: (projectPath: string) =>
      invoke(IPC_CHANNELS.projectsRemove, projectPath) as Promise<void>,
    rename: (oldPath: string, newName: string, renameDir: boolean) =>
      invoke(IPC_CHANNELS.projectsRename, oldPath, newName, renameDir) as Promise<never>,
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
    sendInput: (sessionId: string, text: string, attachments?: Attachment[]) =>
      invoke(IPC_CHANNELS.sessionInput, sessionId, text, attachments) as Promise<void>,
    interrupt: (sessionId: string) =>
      invoke(IPC_CHANNELS.sessionInterrupt, sessionId) as Promise<boolean>,
    terminate: (sessionId: string) =>
      invoke(IPC_CHANNELS.sessionTerminate, sessionId) as Promise<void>,
    onEvent: (cb) => onChannel<LiveSessionEvent>(IPC_CHANNELS.sessionEvent, cb),
    onStatus: (cb) =>
      onChannel<LiveSessionStatusUpdate>(IPC_CHANNELS.sessionStatus, cb),
    onStats: (cb) => onChannel<LiveSessionStats>(IPC_CHANNELS.sessionStats, cb),
    listPersisted: (projectPath: string) =>
      invoke(IPC_CHANNELS.sessionsListPersisted, projectPath) as Promise<Session[]>,
    resume: (localId: string) =>
      invoke(IPC_CHANNELS.sessionsResume, localId) as Promise<string>,
    deletePersisted: (localId: string) =>
      invoke(IPC_CHANNELS.sessionsDeletePersisted, localId) as Promise<void>,
    touchPersisted: (localId: string) =>
      invoke(IPC_CHANNELS.sessionsTouchPersisted, localId) as Promise<void>,
    setModel: (localId: string, model: string) =>
      invoke(IPC_CHANNELS.sessionsSetModel, localId, model) as Promise<void>,
    setEffort: (localId: string, effort: RoleEffort) =>
      invoke(IPC_CHANNELS.sessionsSetEffort, localId, effort) as Promise<void>,
    setPermissionMode: (localId: string, mode: PermissionMode) =>
      invoke(IPC_CHANNELS.sessionsSetPermissionMode, localId, mode) as Promise<void>,
    deleteHistorical: (projectPath: string, sessionId: string) =>
      invoke(IPC_CHANNELS.sessionsDeleteHistorical, projectPath, sessionId) as Promise<void>,
    deleteAllHistorical: (projectPath: string) =>
      invoke(IPC_CHANNELS.sessionsDeleteAllHistorical, projectPath) as Promise<void>,
    deleteAllPersisted: (projectPath: string) =>
      invoke(IPC_CHANNELS.sessionsDeleteAllPersisted, projectPath) as Promise<void>,
    getAgents: (sessionLocalId: string) =>
      invoke(IPC_CHANNELS.sessionsGetAgents, sessionLocalId) as Promise<Agent[]>,
    addAgent: (sessionLocalId: string, params: AddAgentParams) =>
      invoke(IPC_CHANNELS.sessionsAddAgent, sessionLocalId, params) as Promise<string>,
    listTrackedSdkIds: (projectPath: string) =>
      invoke(IPC_CHANNELS.sessionsListTrackedSdkIds, projectPath) as Promise<string[]>,
    reconnectMcp: (agentLocalId: string) =>
      invoke(IPC_CHANNELS.sessionsReconnectMcp, agentLocalId) as Promise<void>,
  },
  worktrees: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.worktreesList, projectPath) as Promise<never>,
    create: (projectPath: string, branchRequest: string) =>
      invoke(IPC_CHANNELS.worktreesCreate, projectPath, branchRequest) as Promise<never>,
    remove: (projectPath: string, worktreePath: string) =>
      invoke(IPC_CHANNELS.worktreesRemove, projectPath, worktreePath) as Promise<void>,
    gitDiffStat: (worktreePath: string, baseBranch?: string) =>
      invoke(IPC_CHANNELS.worktreesGitDiffStat, worktreePath, baseBranch) as Promise<GitDiffStatFile[]>,
  },
  roles: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.rolesList, projectPath) as Promise<never>,
    save: (scope: RoleScope, projectPath: string, role: RoleDraft) =>
      invoke(IPC_CHANNELS.rolesSave, scope, projectPath, role) as Promise<never>,
    remove: (scope: RoleScope, projectPath: string, id: string) =>
      invoke(IPC_CHANNELS.rolesRemove, scope, projectPath, id) as Promise<void>,
    generate: (prompt: string): Promise<RolesGenerateResult> =>
      invoke(IPC_CHANNELS.rolesGenerate, prompt) as Promise<RolesGenerateResult>,
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
    resume: (instanceId: string) =>
      invoke(IPC_CHANNELS.agenciesResume, instanceId) as Promise<never>,
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
    generate: (prompt: string): Promise<string> =>
      invoke(IPC_CHANNELS.skillsGenerate, prompt) as Promise<string>,
    save: (
      projectPath: string,
      id: string,
      scope: 'project' | 'global',
      content: string,
    ): Promise<Skill> =>
      invoke(IPC_CHANNELS.skillsSave, projectPath, id, scope, content) as Promise<Skill>,
  },
  commands: {
    generate: (prompt: string) =>
      invoke(IPC_CHANNELS.commandsGenerate, prompt) as Promise<string>,
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
    onOpenFile: (handler: (filePath: string) => void): () => void =>
      onChannel<string>('plugin:open-file', handler),
    list: () => invoke(IPC_CHANNELS.pluginsList) as Promise<PluginRecord[]>,
    pickAkpFile: () =>
      invoke(IPC_CHANNELS.pluginsPickAkpFile) as Promise<string | null>,
    install: (akpPath?: string) =>
      invoke(IPC_CHANNELS.pluginsInstall, akpPath) as Promise<void>,
    installFromUrl: (manifestUrl: string) =>
      invoke(IPC_CHANNELS.pluginsInstallFromUrl, manifestUrl) as Promise<void>,
    prepareAkpInstall: (opts: { filePath?: string; manifestUrl?: string }) =>
      invoke(IPC_CHANNELS.pluginsPrepareAkpInstall, opts) as Promise<{ manifest: import('@agentkeeper/sdk').PluginManifest; token: string }>,
    confirmAkpInstall: (token: string) =>
      invoke(IPC_CHANNELS.pluginsConfirmAkpInstall, token) as Promise<void>,
    cancelAkpInstall: (token: string) =>
      invoke(IPC_CHANNELS.pluginsCancelAkpInstall, token) as Promise<void>,
    loadDev: (dirPath?: string) =>
      invoke(IPC_CHANNELS.pluginsLoadDev, dirPath) as Promise<void>,
    unloadDev: (pluginId: string) =>
      invoke(IPC_CHANNELS.pluginsUnloadDev, pluginId) as Promise<void>,
    uninstall: (pluginId: string) =>
      invoke(IPC_CHANNELS.pluginsUninstall, pluginId) as Promise<void>,
    enable: (pluginId: string) =>
      invoke(IPC_CHANNELS.pluginsEnable, pluginId) as Promise<void>,
    disable: (pluginId: string) =>
      invoke(IPC_CHANNELS.pluginsDisable, pluginId) as Promise<void>,
    checkUpdates: () =>
      invoke(IPC_CHANNELS.pluginsCheckUpdates) as Promise<UpdateAvailable[]>,
    update: (pluginId: string) =>
      invoke(IPC_CHANNELS.pluginsUpdate, pluginId) as Promise<void>,
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
    create: (params: WorkItemCreateParams) =>
      invoke(IPC_CHANNELS.workItemsCreate, params) as Promise<never>,
  },
  jira: {
    listProjects: () => invoke(IPC_CHANNELS.jiraListProjects) as Promise<JiraProject[]>,
  },
  remotes: {
    detect: (projectPath: string) =>
      invoke(IPC_CHANNELS.remotesDetect, projectPath) as Promise<RemoteSource[]>,
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
  dialog: {
    openFiles: () => invoke(IPC_CHANNELS.dialogOpenFiles) as Promise<Attachment[]>,
  },
  git: {
    getBranch: (projectPath: string) =>
      invoke(IPC_CHANNELS.gitGetBranch, projectPath) as Promise<string | null>,
    getStatus: (projectPath: string) =>
      invoke(IPC_CHANNELS.gitGetStatus, projectPath) as Promise<GitStatus>,
    stageFiles: (projectPath: string, files: string[]) =>
      invoke(IPC_CHANNELS.gitStageFiles, projectPath, files) as Promise<void>,
    unstageFiles: (projectPath: string, files: string[]) =>
      invoke(IPC_CHANNELS.gitUnstageFiles, projectPath, files) as Promise<void>,
    commit: (projectPath: string, message: string) =>
      invoke(IPC_CHANNELS.gitCommit, projectPath, message) as Promise<void>,
    push: (projectPath: string) =>
      invoke(IPC_CHANNELS.gitPush, projectPath) as Promise<string>,
    pull: (projectPath: string) =>
      invoke(IPC_CHANNELS.gitPull, projectPath) as Promise<string>,
    createBranch: (projectPath: string, branchName: string) =>
      invoke(IPC_CHANNELS.gitCreateBranch, projectPath, branchName) as Promise<void>,
    suggestCommits: (projectPath: string) =>
      invoke(IPC_CHANNELS.gitSuggestCommits, projectPath) as Promise<CommitSuggestion>,
    onStatusChanged: (cb: (event: GitStatusChangedEvent) => void) =>
      onChannel<GitStatusChangedEvent>(IPC_CHANNELS.gitStatusChanged, cb),
  },
  fs: {
    listDirectory: (dirPath: string) =>
      invoke(IPC_CHANNELS.fsListDirectory, dirPath) as Promise<FsEntry[]>,
    watchStart: (projectPath: string) =>
      invoke(IPC_CHANNELS.fsWatchStart, projectPath) as Promise<void>,
    watchStop: (projectPath: string) =>
      invoke(IPC_CHANNELS.fsWatchStop, projectPath) as Promise<void>,
    onChanged: (cb: (event: FsChangedEvent) => void) =>
      onChannel<FsChangedEvent>(IPC_CHANNELS.fsChanged, cb),
  },
  plans: {
    list: (projectPath: string) =>
      invoke(IPC_CHANNELS.plansList, projectPath) as Promise<Plan[]>,
    get: (projectPath: string, id: string) =>
      invoke(IPC_CHANNELS.plansGet, projectPath, id) as Promise<Plan | null>,
    create: (projectPath: string, data: PlansCreateInput) =>
      invoke(IPC_CHANNELS.plansCreate, projectPath, data) as Promise<Plan>,
    update: (projectPath: string, id: string, patch: PlansUpdateInput) =>
      invoke(IPC_CHANNELS.plansUpdate, projectPath, id, patch) as Promise<Plan | null>,
    delete: (projectPath: string, id: string) =>
      invoke(IPC_CHANNELS.plansDelete, projectPath, id) as Promise<boolean>,
    onUpdated: (cb: (data: { projectPath: string; id: string }) => void) =>
      onChannel<{ projectPath: string; id: string }>(IPC_CHANNELS.planUpdated, cb),
  },
  costs: {
    getDailySummary: () =>
      invoke(IPC_CHANNELS.costsGetDailySummary) as Promise<DayTotal[]>,
    addLegacy: (entries: Array<LegacyDayEntry>) =>
      invoke(IPC_CHANNELS.costsAddLegacy, entries) as Promise<void>,
  },
  pricing: {
    getTable: () => invoke(IPC_CHANNELS.pricingGetTable) as Promise<Record<string, ModelPricing>>,
    refresh: () => invoke(IPC_CHANNELS.pricingRefresh) as Promise<Record<string, ModelPricing>>,
  },
  drafts: {
    get: (sessionLocalId: string) =>
      invoke(IPC_CHANNELS.draftsGet, sessionLocalId) as Promise<DraftRecord>,
    set: (sessionLocalId: string, text: string, attachments: Attachment[]) =>
      invoke(IPC_CHANNELS.draftsSet, sessionLocalId, text, attachments) as Promise<void>,
    clear: (sessionLocalId: string) =>
      invoke(IPC_CHANNELS.draftsClear, sessionLocalId) as Promise<void>,
  },
  stats: {
    getAll: () =>
      invoke(IPC_CHANNELS.statsGetAll) as Promise<SessionStatRow[]>,
    upsert: (sessionLocalId: string, totalTokens: number, totalCostUsd: number, turnCount: number, inProgressTokens: number) =>
      invoke(IPC_CHANNELS.statsUpsert, sessionLocalId, totalTokens, totalCostUsd, turnCount, inProgressTokens) as Promise<void>,
    importLegacy: (entries: SessionStatRow[]) =>
      invoke(IPC_CHANNELS.statsImportLegacy, entries) as Promise<void>,
  },
  ...(process.env.NODE_ENV === 'development' ? {
    dev: {
      runMigrations: () =>
        invoke(IPC_CHANNELS.devRunMigrations) as Promise<{ applied: number }>,
    },
  } : {}),
}

contextBridge.exposeInMainWorld('agentkeeper', api)

if (process.env.NODE_ENV === 'development') {
  console.log('%c[AgentKeeper dev] run pending migrations: await window.agentkeeper.dev.runMigrations()', 'color: #f59e0b; font-weight: bold')
}
