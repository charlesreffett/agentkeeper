import { app, utilityProcess, MessageChannelMain } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import keytar from 'keytar'
import type { PluginManifest, PluginPermission, WorkItemSource, WorkItemStatus } from '@agentkeeper/sdk'
import type { PluginToHostMessage, HostToPluginMessage } from '@agentkeeper/sdk'
import type { EventBus } from '@agentkeeper/sdk'
import type { WorkItemRegistryFull } from './plugins.js'
import { getRawSqlite } from './db/index.js'
import { recentProjectsStore } from './store.js'
import { detectRemoteSources } from './git.js'
import { buildPluginEnvironment, buildPluginExecArgv } from './plugin-environment.js'

function resolveBootstrapPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return app.isPackaged
    ? path.join(dir, 'plugin-bootstrap.js')
    : path.join(dir, '..', '..', '..', '..', 'packages', 'sdk', 'src', 'bootstrap.ts')
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
  private pendingUiContributions: Array<{ slot: string; contribution: unknown }> = []
  private registeredCommands = new Set<string>()

  constructor(
    private readonly manifest: PluginManifest,
    private readonly entryPath: string,
    private readonly proxyUrl: string,
    private readonly eventBus: EventBus,
    private readonly workItemRegistry: WorkItemRegistryFull,
    private webContents?: Electron.WebContents,
  ) {}

  async spawn(): Promise<void> {
    const bootstrapPath = resolveBootstrapPath()
    const { port1, port2 } = new MessageChannelMain()

    this.proc = utilityProcess.fork(bootstrapPath, [], {
      execArgv: buildPluginExecArgv(this.manifest.permissions, {
        bootstrapPath: path.dirname(bootstrapPath),
        entryPath: path.dirname(this.entryPath),
      }),
      env: buildPluginEnvironment(process.env, {
        proxyUrl: this.proxyUrl,
        entryPath: this.entryPath,
        id: this.manifest.id,
      }),
      serviceName: `plugin:${this.manifest.id}`,
    })

    this.proc.postMessage({ type: 'port' }, [port2])

    this.port = port1
    this.port.start()

    this.port.on('message', (e) => this.handlePluginMessage(e.data as PluginToHostMessage))

    this.proc.on('exit', (code) => {
      // Null out handles regardless of exit code so callers can detect a dead host.
      this.proc = null
      this.port = null
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

  setWebContents(wc: Electron.WebContents): void {
    this.webContents = wc
    const flush = () => {
      for (const { slot, contribution } of this.pendingUiContributions) {
        if (!wc.isDestroyed()) {
          wc.send('plugin:ui-contribution', { pluginId: this.manifest.id, slot, contribution })
        }
      }
      this.pendingUiContributions = []
    }
    if (wc.isLoading()) {
      wc.once('did-finish-load', flush)
    } else {
      flush()
    }
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
    this.registeredCommands.clear()
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
    if (!this.port) return  // process already dead; skip onUninstall IPC
    this.port.postMessage({ type: 'uninstall' } as HostToPluginMessage)
    await awaitAck(this.port, 'uninstalled')
  }

  async invokeCommand(commandId: string, args: unknown): Promise<unknown> {
    const port = this.port
    if (!port) throw new Error('Provider not available')
    if (!this.registeredCommands.has(commandId)) {
      throw new Error(`Provider command is not available: ${commandId}`)
    }
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        port.off('message', handler)
        reject(new Error(`Provider command timed out: ${commandId}`))
      }, 30_000)
      const handler = (event: Electron.MessageEvent) => {
        const message = event.data as PluginToHostMessage
        if (message.type !== 'commands.invoke.result' || message.id !== id) return
        clearTimeout(timeout)
        port.off('message', handler)
        if (message.error) reject(new Error(message.error))
        else resolve(message.result)
      }
      port.on('message', handler)
      port.postMessage({ type: 'commands.invoke', id, commandId, args } as HostToPluginMessage)
    })
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

      case 'projects.list': {
        if (!this.hasPermission('projects')) { this.deny(msg.id, 'Missing projects permission'); break }
        void Promise.all(recentProjectsStore.list().map(async (project) => {
          const detected = await detectRemoteSources(project.path)
          const remotes = detected.map((remote) => ({
            name: remote.remote,
            url: remote.url,
            provider: remote.type,
            repository: remote.repo,
          }))
          if (project.repo && !remotes.some((remote) => remote.provider === 'github' && remote.repository === project.repo)) {
            remotes.push({
              name: 'origin',
              url: `https://github.com/${project.repo}`,
              provider: 'github',
              repository: project.repo,
            })
          }
          return { path: project.path, name: project.name, remotes }
        })).then((projects) => this.respond(msg.id, projects), (error: unknown) => {
          this.deny(msg.id, error instanceof Error ? error.message : String(error))
        })
        break
      }

      case 'environment.get': {
        if (!this.hasPermission('environment')) { this.deny(msg.id, 'Missing environment permission'); break }
        if (!this.manifest.environment?.variables.includes(msg.name)) {
          this.deny(msg.id, `Environment variable is not declared: ${msg.name}`)
          break
        }
        this.respond(msg.id, process.env[msg.name])
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
        if (!this.hasPermission('ui')) break
        if (this.webContents && !this.webContents.isDestroyed()) {
          this.webContents.send('plugin:ui-contribution', {
            pluginId,
            slot: msg.slot,
            contribution: msg.contribution,
          })
        } else {
          this.pendingUiContributions.push({ slot: msg.slot, contribution: msg.contribution })
        }
        break
      }

      // --- Commands ---
      case 'commands.register': {
        if (!this.hasPermission('commands')) break
        this.registeredCommands.add(msg.commandId)
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
      case 'commands.invoke.result':
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
