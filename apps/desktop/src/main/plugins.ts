import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { getRawSqlite } from './db/index'
import { initPluginLoader } from './plugin-loader.js'
import type {
  EventBus,
  EventHandler,
  EventMap,
  IssueTransition,
  ScopedKVStore,
  WorkItem,
  WorkItemCreateParams,
  WorkItemReference,
  WorkItemRegistry,
  WorkItemSource,
  WorkItemStatus,
} from '@agentkeeper/sdk'

export interface WorkItemRegistryFull extends WorkItemRegistry {
  list(sourceId?: string): Promise<WorkItem[]>
  get(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>): Promise<WorkItem | undefined>
  updateStatus(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, status: WorkItemStatus): Promise<void>
  getTransitions(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>): Promise<IssueTransition[]>
  transition(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, name: string): Promise<void>
  addComment(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, body: string): Promise<void>
  create(sourceId: string, params: WorkItemCreateParams): Promise<WorkItem>
}

export class WorkItemRegistryImpl implements WorkItemRegistryFull {
  private readonly sources = new Map<string, WorkItemSource>()

  register(source: WorkItemSource): void {
    this.sources.set(source.id, source)
  }

  unregister(id: string): void {
    this.sources.delete(id)
  }

  async list(sourceId?: string): Promise<WorkItem[]> {
    const selected = sourceId ? [this.requireSource(sourceId)] : Array.from(this.sources.values())
    const results = await Promise.all(selected.map((source) => source.list()))
    return results.flat()
  }

  async get(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>): Promise<WorkItem | undefined> {
    return this.requireSource(reference.sourceId).get(reference.itemId)
  }

  async updateStatus(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, status: WorkItemStatus): Promise<void> {
    const source = this.requireSource(reference.sourceId)
    if (!source.updateStatus) throw new Error(`Source '${source.id}' does not support updateStatus`)
    await source.updateStatus(reference.itemId, status)
  }

  async getTransitions(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>): Promise<IssueTransition[]> {
    const source = this.requireSource(reference.sourceId)
    if (!source.getTransitions) throw new Error(`Source '${source.id}' does not support getTransitions`)
    return source.getTransitions(reference.itemId)
  }

  async transition(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, name: string): Promise<void> {
    const source = this.requireSource(reference.sourceId)
    if (!source.transition) throw new Error(`Source '${source.id}' does not support transition`)
    await source.transition(reference.itemId, name)
  }

  async addComment(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>, body: string): Promise<void> {
    const source = this.requireSource(reference.sourceId)
    if (!source.addComment) throw new Error(`Source '${source.id}' does not support addComment`)
    await source.addComment(reference.itemId, body)
  }

  async create(sourceId: string, params: WorkItemCreateParams): Promise<WorkItem> {
    const source = this.requireSource(sourceId)
    if (!source.create) throw new Error(`Source '${source.id}' does not support create`)
    return source.create(params)
  }

  private requireSource(sourceId: string): WorkItemSource {
    const source = this.sources.get(sourceId)
    if (!source) throw new Error('Provider not available')
    return source
  }
}

function buildSQLiteKVStore(pluginId: string, db: InstanceType<typeof Database>): ScopedKVStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const row = db.prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?').get(pluginId, key) as { value: string } | undefined
      if (!row) return undefined
      return JSON.parse(row.value) as T
    },
    async set(key: string, value: unknown) {
      db.prepare('INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)').run(pluginId, key, JSON.stringify(value))
    },
    async delete(key: string) {
      db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?').run(pluginId, key)
    },
    async list() {
      const rows = db.prepare('SELECT key FROM plugin_storage WHERE plugin_id = ?').all(pluginId) as { key: string }[]
      return rows.map((r) => r.key)
    },
  }
}

function buildEventBus(): EventBus {
  const emitter = new EventEmitter()
  return {
    on<K extends keyof EventMap>(event: K, handler: EventHandler<K>): () => void {
      emitter.on(event as string, handler as (...args: unknown[]) => void)
      return () => emitter.off(event as string, handler as (...args: unknown[]) => void)
    },
    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
      emitter.emit(event as string, payload)
    },
  }
}

// Module-scoped references for IPC access
let pluginEventBus: EventBus | null = null

export function getPluginEventBus(): EventBus | null {
  return pluginEventBus
}

export async function getPluginConfig(pluginId: string, db: InstanceType<typeof Database>): Promise<Record<string, unknown>> {
  const rows = db.prepare('SELECT key, value FROM plugin_storage WHERE plugin_id = ?').all(pluginId) as { key: string; value: string }[]
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value) as unknown]))
}

export async function setPluginConfig(pluginId: string, config: unknown, db: InstanceType<typeof Database>): Promise<void> {
  if (config !== null && typeof config === 'object') {
    const stmt = db.prepare('INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)')
    for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
      stmt.run(pluginId, key, JSON.stringify(value))
    }
  }
  pluginEventBus?.emit('settings.changed', { pluginId, config })
}

export async function activatePlugins(
  workItemRegistry: WorkItemRegistryFull,
  webContents?: Electron.WebContents,
): Promise<void> {
  // Initialize event bus before loader so getPluginEventBus() is non-null during activation
  if (!pluginEventBus) {
    pluginEventBus = buildEventBus()
  }
  await initPluginLoader(workItemRegistry, webContents)
}

export function pruneLegacyBundledPlugins(): void {
  const db = getRawSqlite()
  db.prepare(`
    DELETE FROM plugin_registry
    WHERE source = 'bundled'
      AND id IN ('agentkeeper-github', 'agentkeeper-jira', 'github', 'jira', 'agentkeeper-test')
  `).run()
}
