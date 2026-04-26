import type { z } from 'zod'

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
  assignee?: string
  reporter?: string
  priority?: string
  storyPoints?: number
  issueType?: string
  parentRef?: string
  links: WorkItemLink[]
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
  allowedTools?: string[]
  allowedPeers?: string[]
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
  id: string
  name?: string
  version?: string
  settings?: z.ZodType<TSettings, z.ZodTypeDef, unknown>
  activate(ctx: PluginContext<TSettings>): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export interface PluginContext<TSettings = unknown> {
  config: TSettings
  logger: Logger
  storage: ScopedKVStore
  secrets: SecretsApi
  events: EventBus
  workItems: WorkItemRegistry
  ui: UIContributions
  commands: CommandRegistry
  background: BackgroundWork
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
  'pr.opened': { prUrl: string; workItemId?: string }
  'pr.merged': { prUrl: string; workItemId?: string }
  'plugin.unhealthy': { pluginId: string; reason: string }
  'plugin.healthy': { pluginId: string }
  'settings.changed': { pluginId: string; config: unknown }
}

export type EventHandler<K extends keyof EventMap> = (
  payload: EventMap[K],
) => void | Promise<void>

export interface EventBus {
  on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): () => void
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void
}

export interface IssueTransition {
  name: string
  toStatus: WorkItemStatus
  toStatusLabel: string
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
  addComment(id: string, body: string): Promise<void>
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
  component: unknown
  label?: string
  icon?: string
  order?: number
  when?: (ctx: unknown) => boolean
}

export interface UIContributions {
  contribute(slot: UISlot, contribution: UIContribution): () => void
}

export interface CommandDefinition {
  id: string
  label: string
  handler: () => void | Promise<void>
  when?: () => boolean
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
