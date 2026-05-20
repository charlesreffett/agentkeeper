import { app } from 'electron'
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import { getRawSqlite } from './db/index'
import type {
  BackgroundWork,
  CommandDefinition,
  CommandRegistry,
  EventBus,
  EventHandler,
  EventMap,
  IssueTransition,
  Logger,
  PluginContext,
  ScopedKVStore,
  SecretsApi,
  UIContribution,
  UIContributions,
  UISlot,
  WorkItem,
  WorkItemCreateParams,
  WorkItemRegistry,
  WorkItemSource,
  WorkItemStatus,
} from '@agentkeeper/sdk'
import { jiraPlugin } from '@agentkeeper/plugin-jira'
import { githubPlugin } from '@agentkeeper/plugin-github'
import { createPluginSecrets } from './secrets'

export interface WorkItemRegistryFull extends WorkItemRegistry {
  list(): Promise<WorkItem[]>
  get(id: string): Promise<WorkItem | undefined>
  updateStatus(id: string, status: WorkItemStatus): Promise<void>
  getTransitions(id: string): Promise<IssueTransition[]>
  transition(id: string, name: string): Promise<void>
  create(params: WorkItemCreateParams): Promise<WorkItem>
}

class WorkItemRegistryImpl implements WorkItemRegistryFull {
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

function buildLogger(pluginId: string): Logger {
  const prefix = `[plugin:${pluginId}]`
  return {
    debug: (msg, meta) => console.debug(prefix, msg, ...(meta !== undefined ? [meta] : [])),
    info: (msg, meta) => console.info(prefix, msg, ...(meta !== undefined ? [meta] : [])),
    warn: (msg, meta) => console.warn(prefix, msg, ...(meta !== undefined ? [meta] : [])),
    error: (msg, meta) => console.error(prefix, msg, ...(meta !== undefined ? [meta] : [])),
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

function buildBackgroundWork(): BackgroundWork {
  return {
    every(intervalMs: number, fn: () => void | Promise<void>): () => void {
      const id = setInterval(() => void fn(), intervalMs)
      return () => clearInterval(id)
    },
    once(fn: () => void | Promise<void>, opts?: { delayMs?: number }): () => void {
      const id = setTimeout(() => void fn(), opts?.delayMs ?? 0)
      return () => clearTimeout(id)
    },
  }
}

const noopUI: UIContributions = {
  contribute(_slot: UISlot, _contribution: UIContribution): () => void {
    return () => {}
  },
}

const noopCommands: CommandRegistry = {
  register(_cmd: CommandDefinition): () => void {
    return () => {}
  },
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

async function activatePlugin<TSettings>(
  pluginId: string,
  plugin: { activate(ctx: PluginContext<TSettings>): void | Promise<void>; deactivate?(): void | Promise<void> },
  registry: WorkItemRegistryImpl,
  bus: EventBus,
  electronApp: typeof app,
): Promise<void> {
  const rawDb = getRawSqlite()
  const kvStore = buildSQLiteKVStore(pluginId, rawDb)
  const persistedConfig = await getPluginConfig(pluginId, rawDb)

  const ctx: PluginContext<TSettings> = {
    config: persistedConfig as TSettings,
    logger: buildLogger(pluginId),
    storage: kvStore,
    secrets: createPluginSecrets(pluginId) as SecretsApi,
    events: bus,
    workItems: registry,
    ui: noopUI,
    commands: noopCommands,
    background: buildBackgroundWork(),
    fetch: globalThis.fetch.bind(globalThis),
  }

  await plugin.activate(ctx)

  electronApp.on('before-quit', () => {
    void plugin.deactivate?.()
  })
}

export async function activatePlugins(
  electronApp: typeof app,
): Promise<WorkItemRegistryFull> {
  const registry = new WorkItemRegistryImpl()
  const bus = buildEventBus()
  pluginEventBus = bus

  await activatePlugin('jira', jiraPlugin, registry, bus, electronApp)
  await activatePlugin('github', githubPlugin, registry, bus, electronApp)

  return registry
}
