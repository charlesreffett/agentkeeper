import { utilityProcess, MessageChannelMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import keytar from 'keytar'
import type { PluginManifest, PluginPermission, WorkItemSource, WorkItemStatus } from '@agentkeeper/sdk'
import type { PluginToHostMessage, HostToPluginMessage } from '@agentkeeper/sdk'
import type { EventBus } from '@agentkeeper/sdk'
import type { WorkItemRegistryFull } from './plugins.js'
import { getRawSqlite } from './db/index.js'

// Dev path — production build needs bootstrap compiled as a separate entry point
// and this path updated to point at the compiled output.
function resolveBootstrapPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return path.join(dir, '..', '..', '..', '..', 'packages', 'sdk', 'src', 'bootstrap.ts')
}

function awaitAck(port: Electron.MessagePortMain, type: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs)
    const handler = (e: Electron.MessageEvent) => {
      const msg = e.data as PluginToHostMessage
      if (msg.type === type) {
        clearTimeout(timer)
        port.off('message', handler)
        resolve()
      }
    }
    port.on('message', handler)
  })
}

export class PluginHost {
  private proc: Electron.UtilityProcess | null = null
  private port: Electron.MessagePortMain | null = null
  private timers = new Map<string, ReturnType<typeof setInterval>>()
  private eventListeners = new Map<string, () => void>()

  constructor(
    private readonly manifest: PluginManifest,
    private readonly entryPath: string,
    private readonly proxyUrl: string,
    private readonly eventBus: EventBus,
    private readonly workItemRegistry: WorkItemRegistryFull,
    private readonly webContents?: Electron.WebContents,
  ) {}

  async spawn(): Promise<void> {
    const bootstrapPath = resolveBootstrapPath()
    const { port1, port2 } = new MessageChannelMain()

    this.proc = utilityProcess.fork(bootstrapPath, [], {
      env: {
        ...process.env,
        AK_PROXY_URL: this.proxyUrl,
        AK_PLUGIN_ENTRY: this.entryPath,
        AK_PLUGIN_ID: this.manifest.id,
      },
      serviceName: `plugin:${this.manifest.id}`,
    })

    this.proc.postMessage({ type: 'port' }, [port2])

    this.port = port1
    this.port.start()

    this.port.on('message', (e) => this.handlePluginMessage(e.data as PluginToHostMessage))

    this.proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[plugin:${this.manifest.id}] exited with code ${code}`)
        this.eventBus.emit('plugin.unhealthy', { pluginId: this.manifest.id, reason: `Process exited with code ${code}` })
        const db = getRawSqlite()
        db.prepare('UPDATE plugin_registry SET enabled = 0 WHERE id = ?').run(this.manifest.id)
      }
    })

    await awaitAck(this.port, 'ready')
  }

  async activate(config: Record<string, unknown>): Promise<void> {
    const msg: HostToPluginMessage = { type: 'activate', config }
    this.port!.postMessage(msg)
    await awaitAck(this.port!, 'activated', 30_000)
    this.eventBus.emit('plugin.activated', { pluginId: this.manifest.id })
  }

  async deactivate(): Promise<void> {
    if (!this.port) return
    this.port.postMessage({ type: 'deactivate' } as HostToPluginMessage)
    try {
      await awaitAck(this.port, 'deactivated', 5_000)
    } catch {
      // Timeout — force terminate
    }
    this.proc?.kill()
    this.proc = null
    this.port = null
    for (const timerId of this.timers.values()) clearInterval(timerId)
    this.timers.clear()
    for (const unsub of this.eventListeners.values()) unsub()
    this.eventListeners.clear()
    this.eventBus.emit('plugin.deactivated', { pluginId: this.manifest.id })
  }

  async install(): Promise<void> {
    this.port!.postMessage({ type: 'install' } as HostToPluginMessage)
    await awaitAck(this.port!, 'installed')
  }

  async update(previousVersion: string): Promise<void> {
    this.port!.postMessage({ type: 'update', previousVersion } as HostToPluginMessage)
    await awaitAck(this.port!, 'updated')
  }

  async uninstall(): Promise<void> {
    this.port!.postMessage({ type: 'uninstall' } as HostToPluginMessage)
    await awaitAck(this.port!, 'uninstalled')
  }

  private hasPermission(permission: PluginPermission): boolean {
    return this.manifest.permissions.includes(permission)
  }

  private deny(id: string, reason: string): void {
    this.port!.postMessage({ type: 'response', id, error: reason } as HostToPluginMessage)
  }

  private respond(id: string, result?: unknown): void {
    this.port!.postMessage({ type: 'response', id, result } as HostToPluginMessage)
  }

  private handlePluginMessage(msg: PluginToHostMessage): void {
    const db = getRawSqlite()
    const pluginId = this.manifest.id

    switch (msg.type) {
      // --- Storage ---
      case 'storage.get': {
        const row = db.prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
          .get(pluginId, msg.key) as { value: string } | undefined
        this.respond(msg.id, row ? JSON.parse(row.value) as unknown : undefined)
        break
      }
      case 'storage.set': {
        db.prepare('INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)')
          .run(pluginId, msg.key, msg.value)
        this.respond(msg.id)
        break
      }
      case 'storage.delete': {
        db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?')
          .run(pluginId, msg.key)
        this.respond(msg.id)
        break
      }
      case 'storage.list': {
        const rows = db.prepare('SELECT key FROM plugin_storage WHERE plugin_id = ?')
          .all(pluginId) as { key: string }[]
        this.respond(msg.id, rows.map((r) => r.key))
        break
      }

      // --- Secrets ---
      case 'secrets.get': {
        if (!this.hasPermission('secrets')) { this.deny(msg.id, 'Missing secrets permission'); break }
        void keytar.getPassword(`agentkeeper:${pluginId}`, msg.key)
          .then((v) => this.respond(msg.id, v ?? undefined))
        break
      }
      case 'secrets.set': {
        if (!this.hasPermission('secrets')) { this.deny(msg.id, 'Missing secrets permission'); break }
        void keytar.setPassword(`agentkeeper:${pluginId}`, msg.key, msg.value)
          .then(() => this.respond(msg.id))
        break
      }
      case 'secrets.delete': {
        if (!this.hasPermission('secrets')) { this.deny(msg.id, 'Missing secrets permission'); break }
        void keytar.deletePassword(`agentkeeper:${pluginId}`, msg.key)
          .then(() => this.respond(msg.id))
        break
      }

      // --- Events ---
      case 'events.emit': {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this.eventBus.emit as (e: string, p: unknown) => void)(msg.event, msg.payload)
        break
      }
      case 'events.on': {
        const { listenerId, event } = msg
        const handler = (payload: unknown): void => {
          this.port?.postMessage({
            type: 'events.dispatch',
            listenerId,
            event,
            payload,
          } as HostToPluginMessage)
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unsub = (this.eventBus.on as (e: string, h: (p: unknown) => void) => () => void)(event, handler)
        this.eventListeners.set(listenerId, unsub)
        this.respond(msg.id)
        break
      }
      case 'events.off': {
        const unsub = this.eventListeners.get(msg.listenerId)
        unsub?.()
        this.eventListeners.delete(msg.listenerId)
        break
      }

      // --- WorkItems ---
      case 'workItems.register': {
        if (!this.hasPermission('workItems')) { this.deny(msg.id, 'Missing workItems permission'); break }
        const port = this.port!
        const sourceId = msg.sourceId
        const makeId = () => Math.random().toString(36).slice(2)

        const proxySource: WorkItemSource = {
          id: sourceId,
          label: sourceId,
          list: () => new Promise((res, rej) => {
            const id = makeId()
            const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
            const handler = (e: Electron.MessageEvent) => {
              const m = e.data as PluginToHostMessage
              if (m.type === 'workItems.list.result' && m.id === id) {
                clearTimeout(cleanup)
                port.off('message', handler)
                res(m.items as import('@agentkeeper/sdk').WorkItem[])
              }
            }
            port.on('message', handler)
            port.postMessage({ type: 'workItems.list', id } as HostToPluginMessage)
          }),
          get: (itemId) => new Promise((res, rej) => {
            const id = makeId()
            const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
            const handler = (e: Electron.MessageEvent) => {
              const m = e.data as PluginToHostMessage
              if (m.type === 'workItems.get.result' && m.id === id) {
                clearTimeout(cleanup)
                port.off('message', handler)
                res(m.item as import('@agentkeeper/sdk').WorkItem | undefined)
              }
            }
            port.on('message', handler)
            port.postMessage({ type: 'workItems.get', id, itemId } as HostToPluginMessage)
          }),
          updateStatus: async (itemId, status) => {
            const id = makeId()
            await new Promise<void>((res, rej) => {
              const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
              const handler = (e: Electron.MessageEvent) => {
                const m = e.data as PluginToHostMessage
                if (m.type === 'workItems.updateStatus.result' && m.id === id) {
                  clearTimeout(cleanup); port.off('message', handler); res()
                }
              }
              port.on('message', handler)
              port.postMessage({ type: 'workItems.updateStatus', id, itemId, status } as HostToPluginMessage)
            })
          },
          addComment: async (itemId, comment) => {
            const id = makeId()
            await new Promise<void>((res, rej) => {
              const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
              const handler = (e: Electron.MessageEvent) => {
                const m = e.data as PluginToHostMessage
                if (m.type === 'workItems.addComment.result' && m.id === id) {
                  clearTimeout(cleanup); port.off('message', handler); res()
                }
              }
              port.on('message', handler)
              port.postMessage({ type: 'workItems.addComment', id, itemId, comment } as HostToPluginMessage)
            })
          },
          getTransitions: async (itemId) => {
            const id = makeId()
            return new Promise<import('@agentkeeper/sdk').IssueTransition[]>((res, rej) => {
              const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
              const handler = (e: Electron.MessageEvent) => {
                const m = e.data as PluginToHostMessage
                if (m.type === 'workItems.getTransitions.result' && m.id === id) {
                  clearTimeout(cleanup); port.off('message', handler)
                  res(m.transitions as import('@agentkeeper/sdk').IssueTransition[])
                }
              }
              port.on('message', handler)
              port.postMessage({ type: 'workItems.getTransitions', id, itemId } as HostToPluginMessage)
            })
          },
          transition: async (itemId, transitionId) => {
            const id = makeId()
            await new Promise<void>((res, rej) => {
              const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
              const handler = (e: Electron.MessageEvent) => {
                const m = e.data as PluginToHostMessage
                if (m.type === 'workItems.transition.result' && m.id === id) {
                  clearTimeout(cleanup); port.off('message', handler); res()
                }
              }
              port.on('message', handler)
              port.postMessage({ type: 'workItems.transition', id, itemId, transitionId } as HostToPluginMessage)
            })
          },
          create: async (fields) => {
            const id = makeId()
            return new Promise<import('@agentkeeper/sdk').WorkItem>((res, rej) => {
              const cleanup = setTimeout(() => rej(new Error('Timeout')), 10_000)
              const handler = (e: Electron.MessageEvent) => {
                const m = e.data as PluginToHostMessage
                if (m.type === 'workItems.create.result' && m.id === id) {
                  clearTimeout(cleanup); port.off('message', handler)
                  res(m.item as import('@agentkeeper/sdk').WorkItem)
                }
              }
              port.on('message', handler)
              port.postMessage({ type: 'workItems.create', id, fields } as HostToPluginMessage)
            })
          },
        }
        this.workItemRegistry.register(proxySource)
        this.respond(msg.id)
        break
      }
      case 'workItems.unregister': {
        this.workItemRegistry.unregister(msg.sourceId)
        break
      }

      // --- Logger ---
      case 'logger.debug': console.debug(`[plugin:${pluginId}]`, msg.message); break
      case 'logger.info':  console.info(`[plugin:${pluginId}]`, msg.message); break
      case 'logger.warn':  console.warn(`[plugin:${pluginId}]`, msg.message); break
      case 'logger.error': console.error(`[plugin:${pluginId}]`, msg.message); break

      // --- Background ---
      case 'background.every': {
        if (!this.hasPermission('background')) break
        const timerId = setInterval(() => {
          this.port?.postMessage({ type: 'background.tick', taskId: msg.taskId } as HostToPluginMessage)
        }, msg.intervalMs)
        this.timers.set(msg.taskId, timerId)
        break
      }
      case 'background.once': {
        if (!this.hasPermission('background')) break
        const t = setTimeout(() => {
          this.port?.postMessage({ type: 'background.tick', taskId: msg.taskId } as HostToPluginMessage)
          this.timers.delete(msg.taskId)
        }, msg.delayMs)
        this.timers.set(msg.taskId, t as unknown as ReturnType<typeof setInterval>)
        break
      }

      // --- UI ---
      case 'ui.contribute': {
        if (!this.hasPermission('sidebar')) break
        this.webContents?.send('plugin:ui-contribution', {
          pluginId,
          slot: msg.slot,
          contribution: msg.contribution,
        })
        break
      }

      // --- Commands ---
      case 'commands.register': {
        if (!this.hasPermission('commands')) break
        console.info(`[plugin:${pluginId}] registered command: ${msg.commandId}`)
        break
      }

      // Lifecycle acks — handled by awaitAck
      case 'ready':
      case 'activated':
      case 'deactivated':
      case 'installed':
      case 'updated':
      case 'uninstalled':
        break

      // workItems result acks — handled inline by proxySource listeners
      case 'workItems.list.result':
      case 'workItems.get.result':
      case 'workItems.updateStatus.result':
      case 'workItems.addComment.result':
      case 'workItems.getTransitions.result':
      case 'workItems.transition.result':
      case 'workItems.create.result':
        break

      default:
        console.warn(`[plugin:${pluginId}] unknown message type:`, (msg as { type: string }).type)
    }
  }
}
