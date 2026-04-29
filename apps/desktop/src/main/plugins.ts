import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
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

function buildKVStore(pluginId: string): ScopedKVStore {
  const dir = join(app.getPath('userData'), 'plugins', pluginId)
  const file = join(dir, 'kv.json')

  function read(): Record<string, unknown> {
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  function write(data: Record<string, unknown>): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      return read()[key] as T | undefined
    },
    async set<T>(key: string, value: T): Promise<void> {
      const data = read()
      data[key] = value
      write(data)
    },
    async delete(key: string): Promise<void> {
      const data = read()
      delete data[key]
      write(data)
    },
    async list(prefix?: string): Promise<string[]> {
      const keys = Object.keys(read())
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
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

function buildPluginContext<TSettings>(
  pluginId: string,
  registry: WorkItemRegistryImpl,
  config: TSettings,
  storage: ScopedKVStore,
): PluginContext<TSettings> {
  return {
    config,
    logger: buildLogger(pluginId),
    storage,
    secrets: createPluginSecrets(pluginId) as SecretsApi,
    events: buildEventBus(),
    workItems: registry,
    ui: noopUI,
    commands: noopCommands,
    background: buildBackgroundWork(),
  }
}

// Module-scoped references for IPC access
let pluginEventBus: EventBus | null = null
const pluginKVStores = new Map<string, ScopedKVStore>()

export function getPluginEventBus(): EventBus | null {
  return pluginEventBus
}

export async function getPluginConfig(pluginId: string): Promise<unknown> {
  const store = pluginKVStores.get(pluginId)
  if (!store) return {}
  const keys = await store.list()
  const config: Record<string, unknown> = {}
  for (const key of keys) {
    config[key] = await store.get(key)
  }
  return config
}

export async function setPluginConfig(pluginId: string, config: unknown): Promise<void> {
  const store = pluginKVStores.get(pluginId)
  if (!store) return
  if (config !== null && typeof config === 'object') {
    for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
      await store.set(key, value)
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
  const kvStore = buildKVStore(pluginId)
  pluginKVStores.set(pluginId, kvStore)

  const persistedConfig: Record<string, unknown> = {}
  for (const key of await kvStore.list()) {
    persistedConfig[key] = await kvStore.get(key)
  }

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
