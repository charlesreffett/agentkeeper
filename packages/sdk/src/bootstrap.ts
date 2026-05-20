import * as http from 'node:http'
import * as https from 'node:https'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import type { PluginToHostMessage, HostToPluginMessage } from './protocol.js'
import type {
  Plugin,
  PluginContext,
  ScopedKVStore,
  SecretsApi,
  Logger,
  EventBus,
  WorkItemRegistry,
  WorkItemSource,
  UIContributions,
  CommandRegistry,
  BackgroundWork,
} from './index.js'

const DENY_ALL_SENTINEL = 'http://127.0.0.1:0/__deny_all__'

// --- Step 1: Read env vars ---
const proxyUrl = process.env['AK_PROXY_URL']
const pluginEntry = process.env['AK_PLUGIN_ENTRY']!
const pluginId = process.env['AK_PLUGIN_ID']!

// --- Step 2-3: Install proxy agents ---
if (proxyUrl) {
  if (proxyUrl === DENY_ALL_SENTINEL) {
    const denyAgent = new (class extends http.Agent {
      createConnection(): never {
        throw new Error('NetworkPermissionDenied: plugin has no network permission')
      }
    })()
    ;(http as unknown as Record<string, unknown>)['globalAgent'] = denyAgent
    ;(https as unknown as Record<string, unknown>)['globalAgent'] = denyAgent
  } else {
    ;(http as unknown as Record<string, unknown>)['globalAgent'] = new HttpProxyAgent(proxyUrl)
    ;(https as unknown as Record<string, unknown>)['globalAgent'] = new HttpsProxyAgent(proxyUrl)
    try {
      const { setGlobalDispatcher, ProxyAgent } = await import('undici')
      setGlobalDispatcher(new ProxyAgent(proxyUrl))
    } catch { /* undici not available */ }
  }
}

// --- Step 4: MessagePort setup ---
let port: any

await new Promise<void>((resolve) => {
  ;(process as any).parentPort.once('message', (e: any) => {
    port = e.ports[0]
    resolve()
  })
})

if (!port) throw new Error('bootstrap: no MessagePort received from host')

// --- Pending response map ---
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const listeners = new Map<string, (event: string, payload: unknown) => void>()
const taskHandlers = new Map<string, () => void | Promise<void>>()
const workItemSources = new Map<string, WorkItemSource>()

// --- Helper: send a message and await correlated response ---
function sendToHost(msg: PluginToHostMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject })
    ;(port as any).postMessage(msg)
  })
}

function fireToHost(msg: PluginToHostMessage): void {
  ;(port as any).postMessage(msg)
}

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

// --- Step 5: Build PluginContext proxy ---

const storage: ScopedKVStore = {
  async get<T>(key: string): Promise<T | undefined> {
    return sendToHost({ id: makeId(), type: 'storage.get', key }) as Promise<T | undefined>
  },
  async set(key: string, value: unknown): Promise<void> {
    await sendToHost({ id: makeId(), type: 'storage.set', key, value: JSON.stringify(value) })
  },
  async delete(key: string): Promise<void> {
    await sendToHost({ id: makeId(), type: 'storage.delete', key })
  },
  async list(prefix?: string): Promise<string[]> {
    const keys = (await sendToHost({ id: makeId(), type: 'storage.list' })) as string[]
    return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys
  },
}

const secrets: SecretsApi = {
  get: (key) => sendToHost({ id: makeId(), type: 'secrets.get', key }) as Promise<string | undefined>,
  set: (key, value) => sendToHost({ id: makeId(), type: 'secrets.set', key, value }) as Promise<void>,
  delete: (key) => sendToHost({ id: makeId(), type: 'secrets.delete', key }) as Promise<void>,
}

const logger: Logger = {
  debug: (msg, meta) => fireToHost({ id: makeId(), type: 'logger.debug', message: msg, args: meta !== undefined ? [meta] : [] }),
  info:  (msg, meta) => fireToHost({ id: makeId(), type: 'logger.info',  message: msg, args: meta !== undefined ? [meta] : [] }),
  warn:  (msg, meta) => fireToHost({ id: makeId(), type: 'logger.warn',  message: msg, args: meta !== undefined ? [meta] : [] }),
  error: (msg, meta) => fireToHost({ id: makeId(), type: 'logger.error', message: msg, args: meta !== undefined ? [meta] : [] }),
}

const events = {
  emit(event: string, payload: unknown): void {
    fireToHost({ id: makeId(), type: 'events.emit', event, payload })
  },
  on(event: string, handler: (payload: unknown) => void | Promise<void>): () => void {
    const listenerId = makeId()
    listeners.set(listenerId, handler as (event: string, payload: unknown) => void)
    void sendToHost({ id: makeId(), type: 'events.on', event, listenerId })
    return () => {
      listeners.delete(listenerId)
      void sendToHost({ id: makeId(), type: 'events.off', listenerId })
    }
  },
} as unknown as EventBus

const workItems: WorkItemRegistry = {
  register(source) {
    workItemSources.set(source.id, source)
    fireToHost({ id: makeId(), type: 'workItems.register', sourceId: source.id })
  },
  unregister(id) {
    workItemSources.delete(id)
    fireToHost({ id: makeId(), type: 'workItems.unregister', sourceId: id })
  },
  async addComment(id, body) {
    for (const src of workItemSources.values()) {
      if (src.addComment) {
        await src.addComment(id, body)
        return
      }
    }
  },
}

const ui: UIContributions = {
  contribute(slot, contribution) {
    fireToHost({ id: makeId(), type: 'ui.contribute', slot: slot as string, contribution })
    return () => {}
  },
}

const commands: CommandRegistry = {
  register(cmd) {
    fireToHost({ id: makeId(), type: 'commands.register', commandId: cmd.id, definition: cmd })
    return () => {}
  },
}

const background: BackgroundWork = {
  every(intervalMs, fn) {
    const taskId = makeId()
    taskHandlers.set(taskId, fn)
    fireToHost({ id: makeId(), type: 'background.every', intervalMs, taskId })
    return () => { taskHandlers.delete(taskId) }
  },
  once(fn, options) {
    const taskId = makeId()
    taskHandlers.set(taskId, fn)
    fireToHost({ id: makeId(), type: 'background.once', delayMs: options?.delayMs ?? 0, taskId })
    return () => { taskHandlers.delete(taskId) }
  },
}

const ctx: PluginContext<Record<string, unknown>> = {
  config: {} as Record<string, unknown>,
  logger,
  storage,
  secrets,
  events,
  workItems,
  ui,
  commands,
  background,
  fetch: globalThis.fetch.bind(globalThis),
}

// --- Step 6-7: Load plugin entry ---
const pluginModule = await import(pluginEntry) as { default: Plugin<Record<string, unknown>> }
const plugin = pluginModule.default

// --- Step 8: Send ready ---
fireToHost({ id: makeId(), type: 'ready' })

// --- Inbound message router ---
port.on('message', async (e: any) => {
  const msg = e.data as HostToPluginMessage

  if (msg.type === 'response') {
    const p = pending.get(msg.id)
    if (p) {
      pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error))
      else p.resolve(msg.result)
    }
    return
  }

  if (msg.type === 'activate') {
    ctx.config = msg.config
    await plugin.activate(ctx)
    fireToHost({ id: makeId(), type: 'activated' })
    return
  }

  if (msg.type === 'deactivate') {
    await plugin.deactivate?.()
    fireToHost({ id: makeId(), type: 'deactivated' })
    return
  }

  if (msg.type === 'install') {
    await plugin.onInstall?.(ctx)
    fireToHost({ id: makeId(), type: 'installed' })
    return
  }

  if (msg.type === 'update') {
    await plugin.onUpdate?.(ctx, msg.previousVersion)
    fireToHost({ id: makeId(), type: 'updated' })
    return
  }

  if (msg.type === 'uninstall') {
    await plugin.onUninstall?.(ctx)
    fireToHost({ id: makeId(), type: 'uninstalled' })
    return
  }

  if (msg.type === 'background.tick') {
    const fn = taskHandlers.get(msg.taskId)
    if (fn) await fn()
    return
  }

  if (msg.type === 'events.dispatch') {
    const handler = listeners.get(msg.listenerId)
    if (handler) handler(msg.event, msg.payload)
    return
  }

  // workItems.* host → plugin: route to the registered WorkItemSource
  if (msg.type === 'workItems.list') {
    const src = Array.from(workItemSources.values())[0]
    const items = (await src?.list?.()) ?? []
    fireToHost({ id: msg.id, type: 'workItems.list.result', items })
    return
  }

  if (msg.type === 'workItems.get') {
    const src = Array.from(workItemSources.values())[0]
    const item = await src?.get?.(msg.itemId)
    fireToHost({ id: msg.id, type: 'workItems.get.result', item })
    return
  }

  if (msg.type === 'workItems.updateStatus') {
    const src = Array.from(workItemSources.values())[0]
    await src?.updateStatus?.(msg.itemId, msg.status as any)
    fireToHost({ id: msg.id, type: 'workItems.updateStatus.result' })
    return
  }

  if (msg.type === 'workItems.addComment') {
    const src = Array.from(workItemSources.values())[0]
    await src?.addComment?.(msg.itemId, msg.comment)
    fireToHost({ id: msg.id, type: 'workItems.addComment.result' })
    return
  }

  if (msg.type === 'workItems.getTransitions') {
    const src = Array.from(workItemSources.values())[0]
    const transitions = (await src?.getTransitions?.(msg.itemId)) ?? []
    fireToHost({ id: msg.id, type: 'workItems.getTransitions.result', transitions })
    return
  }

  if (msg.type === 'workItems.transition') {
    const src = Array.from(workItemSources.values())[0]
    await src?.transition?.(msg.itemId, msg.transitionId)
    fireToHost({ id: msg.id, type: 'workItems.transition.result' })
    return
  }

  if (msg.type === 'workItems.create') {
    const src = Array.from(workItemSources.values())[0]
    const item = await src?.create?.(msg.fields as any)
    fireToHost({ id: msg.id, type: 'workItems.create.result', item })
    return
  }
})

port.start()

void pluginId // consumed via env, referenced to satisfy linting
