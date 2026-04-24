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
  Logger,
  PluginContext,
  ScopedKVStore,
  SecretsApi,
  UIContribution,
  UIContributions,
  UISlot,
  WorkItem,
  WorkItemRegistry,
  WorkItemSource,
  WorkItemStatus,
} from '@orchestral/sdk'
import { jiraPlugin } from '@orchestral/plugin-jira'
import { createPluginSecrets } from './secrets'

export interface WorkItemRegistryFull extends WorkItemRegistry {
  list(): Promise<WorkItem[]>
  get(id: string): Promise<WorkItem | undefined>
  updateStatus(id: string, status: WorkItemStatus): Promise<void>
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
    console.warn('[plugin] UIContributions.contribute called but not implemented')
    return () => {}
  },
}

const noopCommands: CommandRegistry = {
  register(_cmd: CommandDefinition): () => void {
    console.warn('[plugin] CommandRegistry.register called but not implemented')
    return () => {}
  },
}

function buildPluginContext<TSettings>(
  pluginId: string,
  registry: WorkItemRegistryImpl,
  config: TSettings,
): PluginContext<TSettings> {
  return {
    config,
    logger: buildLogger(pluginId),
    storage: buildKVStore(pluginId),
    secrets: createPluginSecrets(pluginId) as SecretsApi,
    events: buildEventBus(),
    workItems: registry,
    ui: noopUI,
    commands: noopCommands,
    background: buildBackgroundWork(),
  }
}

export async function activatePlugins(
  electronApp: typeof app,
): Promise<WorkItemRegistryFull> {
  const registry = new WorkItemRegistryImpl()

  type JiraConfig = Parameters<(typeof jiraPlugin)['activate']>[0]['config']
  const ctx = buildPluginContext<JiraConfig>('jira', registry, {})

  await jiraPlugin.activate(ctx)

  electronApp.on('before-quit', () => {
    void jiraPlugin.deactivate?.()
  })

  return registry
}
