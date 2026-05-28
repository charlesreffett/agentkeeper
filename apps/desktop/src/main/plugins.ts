import * as fs from 'node:fs'
import * as path from 'node:path'
import { app } from 'electron'
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { getRawSqlite } from './db/index'
import type {
  EventBus,
  EventHandler,
  EventMap,
  IssueTransition,
  ScopedKVStore,
  WorkItem,
  WorkItemCreateParams,
  WorkItemRegistry,
  WorkItemSource,
  WorkItemStatus,
} from '@agentkeeper/sdk'

export interface WorkItemRegistryFull extends WorkItemRegistry {
  list(): Promise<WorkItem[]>
  get(id: string): Promise<WorkItem | undefined>
  updateStatus(id: string, status: WorkItemStatus): Promise<void>
  getTransitions(id: string): Promise<IssueTransition[]>
  transition(id: string, name: string): Promise<void>
  create(params: WorkItemCreateParams): Promise<WorkItem>
}

export class WorkItemRegistryImpl implements WorkItemRegistryFull {
  private readonly sources = new Map<string, WorkItemSource>()

  register(source: WorkItemSource): void {
    this.sources.set(source.id, source)
  }

  unregister(id: string): void {
    this.sources.delete(id)
  }

  async list(): Promise<WorkItem[]> {
    const results = await Promise.all(
      Array.from(this.sources.values()).map((s) => s.list()),
    )
    return results.flat()
  }

  async get(id: string): Promise<WorkItem | undefined> {
    for (const source of this.sources.values()) {
      const item = await source.get(id)
      if (item !== undefined) return item
    }
    return undefined
  }

  async updateStatus(id: string, status: WorkItemStatus): Promise<void> {
    for (const source of this.sources.values()) {
      const item = await source.get(id)
      if (item !== undefined) {
        if (!source.updateStatus) throw new Error(`Source '${source.id}' does not support updateStatus`)
        await source.updateStatus(id, status)
        return
      }
    }
    throw new Error(`No registered source owns work item '${id}'`)
  }

  async addComment(id: string, body: string): Promise<void> {
    const item = await this.get(id)
    if (!item) return
    const source = this.sources.get(item.source)
    await source?.addComment?.(id, body)
  }

  async getTransitions(id: string): Promise<IssueTransition[]> {
    for (const source of this.sources.values()) {
      const item = await source.get(id)
      if (item !== undefined) {
        if (!source.getTransitions) throw new Error(`Source '${source.id}' does not support getTransitions`)
        return source.getTransitions(id)
      }
    }
    throw new Error(`No registered source owns work item '${id}'`)
  }

  async transition(id: string, name: string): Promise<void> {
    for (const source of this.sources.values()) {
      const item = await source.get(id)
      if (item !== undefined) {
        if (!source.transition) throw new Error(`Source '${source.id}' does not support transition`)
        await source.transition(id, name)
        return
      }
    }
    throw new Error(`No registered source owns work item '${id}'`)
  }

  async create(params: WorkItemCreateParams): Promise<WorkItem> {
    for (const source of this.sources.values()) {
      if (source.create) return source.create(params)
    }
    throw new Error('No registered source supports creating work items.')
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

export async function activatePlugins(workItemRegistry: WorkItemRegistryFull): Promise<void> {
  // Initialize event bus before loader so getPluginEventBus() is non-null during activation
  if (!pluginEventBus) {
    pluginEventBus = buildEventBus()
  }
  const { initPluginLoader } = await import('./plugin-loader.js')
  await initPluginLoader(workItemRegistry)
}

export function installBundledPlugins(): void {
  const db = getRawSqlite()
  const isDev = !app.isPackaged
  // Use app.getAppPath() (= apps/desktop in dev) to reliably find the repo root
  const repoRoot = isDev ? path.resolve(app.getAppPath(), '../..') : ''

  const bundled = [
    {
      id: 'agentkeeper-github',
      name: 'GitHub',
      version: '0.1.0',
      dirPath: isDev
        ? path.join(repoRoot, 'packages', 'plugin-github')
        : path.join(process.resourcesPath, 'plugins', 'plugin-github'),
    },
    {
      id: 'agentkeeper-jira',
      name: 'Jira',
      version: '0.1.0',
      dirPath: isDev
        ? path.join(repoRoot, 'packages', 'plugin-jira')
        : path.join(process.resourcesPath, 'plugins', 'plugin-jira'),
    },
    {
      id: 'agentkeeper-test',
      name: 'Test Plugin',
      version: '1.0.0',
      dirPath: isDev
        ? path.join(repoRoot, 'packages', 'plugin-test')
        : path.join(process.resourcesPath, 'plugins', 'plugin-test'),
    },
  ]

  for (const p of bundled) {
    const manifestPath = path.join(p.dirPath, 'manifest.json')
    let manifestJson = '{}'
    try { manifestJson = fs.readFileSync(manifestPath, 'utf8') } catch {}

    const existing = db.prepare('SELECT id FROM plugin_registry WHERE id = ?').get(p.id)
    if (!existing) {
      db.prepare(`
        INSERT INTO plugin_registry (id, name, version, enabled, manifest, source, installed_at, dev_path)
        VALUES (?, ?, ?, 1, ?, 'bundled', ?, ?)
      `).run(p.id, p.name, p.version, manifestJson, Date.now(), p.dirPath)
    } else {
      // Refresh manifest and dev_path each startup so stale/empty manifests self-heal
      db.prepare('UPDATE plugin_registry SET manifest = ?, dev_path = ? WHERE id = ?')
        .run(manifestJson, p.dirPath, p.id)
    }
  }
}
