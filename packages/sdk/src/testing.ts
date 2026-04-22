import type {
  CommandDefinition,
  EventHandler,
  EventMap,
  PluginContext,
  UIContribution,
  UISlot,
  WorkItemSource,
} from './index'

export interface MockContextOptions<TSettings = unknown> {
  config?: TSettings
  secrets?: Record<string, string>
  storage?: Record<string, unknown>
}

export interface MockContext<TSettings = unknown> extends PluginContext<TSettings> {
  _inspect: {
    uiContributions: Map<UISlot, UIContribution[]>
    commands: Map<string, CommandDefinition>
    workItemSources: Map<string, WorkItemSource>
    eventHandlers: Map<keyof EventMap, Set<EventHandler<keyof EventMap>>>
    logs: Array<{ level: string; msg: string; meta?: unknown }>
    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void
  }
}

export function createMockContext<TSettings = unknown>(
  options: MockContextOptions<TSettings> = {},
): MockContext<TSettings> {
  const storage = new Map<string, unknown>(
    Object.entries(options.storage ?? {}),
  )
  const secrets = new Map<string, string>(
    Object.entries(options.secrets ?? {}),
  )
  const uiContributions = new Map<UISlot, UIContribution[]>()
  const commands = new Map<string, CommandDefinition>()
  const workItemSources = new Map<string, WorkItemSource>()
  const eventHandlers = new Map<
    keyof EventMap,
    Set<EventHandler<keyof EventMap>>
  >()
  const logs: Array<{ level: string; msg: string; meta?: unknown }> = []

  return {
    config: (options.config ?? undefined) as TSettings,
    logger: {
      debug: (msg, meta) => logs.push({ level: 'debug', msg, meta }),
      info: (msg, meta) => logs.push({ level: 'info', msg, meta }),
      warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
      error: (msg, meta) => logs.push({ level: 'error', msg, meta }),
    },
    storage: {
      async get<T>(key: string) {
        return storage.get(key) as T | undefined
      },
      async set(key, value) {
        storage.set(key, value)
      },
      async delete(key) {
        storage.delete(key)
      },
      async list(prefix?: string) {
        return Array.from(storage.keys()).filter(
          (k) => !prefix || k.startsWith(prefix),
        )
      },
    },
    secrets: {
      async get(key) {
        return secrets.get(key)
      },
      async set(key, value) {
        secrets.set(key, value)
      },
      async delete(key) {
        secrets.delete(key)
      },
    },
    events: {
      on(event, handler) {
        const set = eventHandlers.get(event) ?? new Set()
        set.add(handler as EventHandler<keyof EventMap>)
        eventHandlers.set(event, set)
        return () => {
          set.delete(handler as EventHandler<keyof EventMap>)
        }
      },
    },
    workItems: {
      registerSource(source) {
        workItemSources.set(source.id, source)
        return () => {
          workItemSources.delete(source.id)
        }
      },
    },
    ui: {
      contribute(slot, contribution) {
        const arr = uiContributions.get(slot) ?? []
        arr.push(contribution)
        uiContributions.set(slot, arr)
        return () => {
          const next = (uiContributions.get(slot) ?? []).filter(
            (c) => c.id !== contribution.id,
          )
          uiContributions.set(slot, next)
        }
      },
    },
    commands: {
      register(cmd) {
        commands.set(cmd.id, cmd)
        return () => {
          commands.delete(cmd.id)
        }
      },
    },
    background: {
      every: () => () => {},
      once: () => () => {},
    },
    _inspect: {
      uiContributions,
      commands,
      workItemSources,
      eventHandlers,
      logs,
      emit<K extends keyof EventMap>(event: K, payload: EventMap[K]) {
        const handlers = eventHandlers.get(event)
        if (!handlers) return
        for (const h of handlers) {
          void (h as EventHandler<K>)(payload)
        }
      },
    },
  }
}
