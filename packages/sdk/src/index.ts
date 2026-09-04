
// ────────────────────────────────────────────────────────────────────────────
// Domain primitives
// ────────────────────────────────────────────────────────────────────────────

export type WorkItemStatus =
  | 'backlog'
  | 'open'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'closed'

export interface WorkItemLink {
  type: 'pr' | 'branch' | 'session' | 'related'
  url: string
  label?: string
}

export interface WorkItem {
  id: string
  source: string
  externalRef: string
  title: string
  body: string
  status: WorkItemStatus
  statusLabel?: string
  statusCategory?: StatusCategory
  assignee?: string
  reporter?: string
  priority?: string
  storyPoints?: number
  issueType?: string
  parentRef?: string
  customFields?: Record<string, string>
  links: WorkItemLink[]
}

/** Persistable address plus an offline display snapshot for a provider-owned work item. */
export interface WorkItemReference {
  sourceId: string
  itemId: string
  externalRef: string
  title?: string
}

export interface WorkItemCreateParams {
  summary: string
  description?: string
  issueType?: string
  priority?: string
  parentRef?: string
}

export interface Role {
  id: string
  name: string
  description: string
  model?: string
  systemPrompt: string
}

export interface Agency {
  id: string
  name: string
  entryPoints: string[]
  roles: string[]
  flows: Array<[string, string]>
}

export type JobStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'

export interface Job {
  id: string
  roleId: string
  worktreePath: string
  sessionId: string
  workItemId?: string
  status: JobStatus
  startedAt: number
  completedAt?: number
}

// ────────────────────────────────────────────────────────────────────────────
// Plugin contract
// ────────────────────────────────────────────────────────────────────────────

export interface Plugin<TSettings = unknown> {
  activate(ctx: PluginContext<TSettings>): void | Promise<void>
  deactivate?(): void | Promise<void>
  onInstall?(ctx: PluginContext<TSettings>): Promise<void>
  onUpdate?(ctx: PluginContext<TSettings>, previousVersion: string): Promise<void>
  onUninstall?(ctx: PluginContext<TSettings>): Promise<void>
}

export interface PluginContext<TSettings = unknown> {
  config: TSettings
  logger: Logger
  storage: ScopedKVStore
  secrets: SecretsApi
  environment: EnvironmentApi
  events: EventBus
  workItems: WorkItemRegistry
  ui: UIContributions
  commands: CommandRegistry
  background: BackgroundWork
  projects: ProjectRegistry
  process: NativeProcessApi
  fetch(url: string | URL, init?: RequestInit): Promise<Response>
}

export interface NativeProcessResult {
  stdout: string
  stderr: string
}

export interface NativeProcessExecOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutMs?: number
}

export interface NativeProcessApi {
  /** Execute a host-approved CLI without granting the plugin direct process access. */
  execFile(file: string, args?: string[], options?: NativeProcessExecOptions): Promise<NativeProcessResult>
}

export interface EnvironmentApi {
  /** Read a host environment variable explicitly declared by the plugin manifest. */
  get(name: string): Promise<string | undefined>
}

export interface ProjectRemote {
  name: string
  url: string
  provider?: string
  repository?: string
}

export interface ProjectDescriptor {
  path: string
  name: string
  remotes: ProjectRemote[]
}

export interface ProjectRegistry {
  list(): Promise<ProjectDescriptor[]>
}

export interface Logger {
  debug(msg: string, meta?: unknown): void
  info(msg: string, meta?: unknown): void
  warn(msg: string, meta?: unknown): void
  error(msg: string, meta?: unknown): void
}

export interface ScopedKVStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set<T = unknown>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<string[]>
}

export interface SecretsApi {
  /** Read only from this plugin's OS credential-store namespace. */
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export type EventMap = {
  'task.selected': { workItemId: string }
  'job.started': { jobId: string }
  'job.completed': { jobId: string }
  'job.failed': { jobId: string; error: string }
  'session.started': { sessionId: string; jobId?: string }
  'session.completed': { sessionId: string }
  'plugin.unhealthy': { pluginId: string; reason: string }
  'plugin.healthy': { pluginId: string }
  'settings.changed': { pluginId: string; config: unknown }
  'plugin.installed': { pluginId: string; version: string }
  'plugin.updated': { pluginId: string; previousVersion: string; version: string }
  'plugin.uninstalled': { pluginId: string }
  'plugin.activated': { pluginId: string }
  'plugin.deactivated': { pluginId: string }
}

export type EventHandler<K extends keyof EventMap> = (
  payload: EventMap[K],
) => void | Promise<void>

export interface EventBus {
  on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): () => void
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void
}

/** Provider-neutral lifecycle categories used to render work-item status consistently. */
export type StatusCategory = 'todo' | 'in-progress' | 'done' | 'unknown'

export interface IssueTransition {
  name: string
  toStatus: WorkItemStatus
  toStatusLabel: string
  toStatusCategory?: StatusCategory
}

export interface WorkItemSource {
  id: string
  label: string
  list(): Promise<WorkItem[]>
  get(id: string): Promise<WorkItem | undefined>
  updateStatus?(id: string, status: WorkItemStatus): Promise<void>
  addComment?(id: string, body: string): Promise<void>
  getTransitions?(id: string): Promise<IssueTransition[]>
  transition?(id: string, name: string): Promise<void>
  create?(params: WorkItemCreateParams): Promise<WorkItem>
}

export interface WorkItemRegistry {
  register(source: WorkItemSource): void
  unregister(id: string): void
}

export type UISlot =
  | 'sidebar.primary'
  | 'session.detail.tabs'
  | 'worktree.toolbar'
  | 'commandPalette'
  | 'settingsPanels'
  | 'roleTemplates'

export interface UIContribution {
  id: string
  label?: string
  icon?: string
  order?: number
}

export interface UIContributions {
  contribute(slot: UISlot, contribution: UIContribution): () => void
}

export interface CommandDefinition {
  id: string
  label: string
  handler: (args: unknown) => unknown | Promise<unknown>
}

export interface CommandRegistry {
  register(cmd: CommandDefinition): () => void
}

export interface BackgroundWork {
  every(intervalMs: number, fn: () => void | Promise<void>): () => void
  once(fn: () => void | Promise<void>, options?: { delayMs?: number }): () => void
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

export function definePlugin<TSettings>(plugin: Plugin<TSettings>): Plugin<TSettings> {
  return plugin
}

export * from './manifest.js'
export * from './protocol.js'
