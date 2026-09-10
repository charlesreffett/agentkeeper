import { MessageChannelMain } from 'electron'
import { randomUUID } from 'node:crypto'
import keytar from 'keytar'
import {
  assertBoundedStructuredValue,
  parsePluginToHostMessage,
  PLUGIN_PROTOCOL_LIMITS,
  type EventBus,
  type HostToPluginMessage,
  type IssueTransition,
  type PluginManifest,
  type PluginPermission,
  type PluginToHostMessage,
  type WorkItem,
  type WorkItemSource,
} from '@agentkeeper/sdk'
import type { WorkItemRegistryFull } from './plugins.js'
import { getRawSqlite } from './db/index.js'
import { recentProjectsStore } from './store.js'
import { detectRemoteSources } from './git.js'
import { SandboxedPluginProcess } from './plugin-sandbox.js'
import type { PluginAuthority } from './plugin-authority.js'
import { fetchForPlugin } from './plugin-network-broker.js'
import { PluginNativeProcessBroker } from './plugin-native-process-broker.js'
import { filterPluginSubscription, normalizePluginEmittedEvent } from './plugin-event-policy.js'
import {
  assertBackgroundDelay,
  assertResourceCapacity,
  PLUGIN_HOST_LIMITS,
  PluginMessageRateLimiter,
} from './plugin-protocol-policy.js'
import { PluginWorkItemOwnership } from './plugin-work-item-policy.js'

type PluginMessageType = PluginToHostMessage['type']
type HostRequestMessage = Extract<HostToPluginMessage, { id: string }>

interface PendingResponse {
  expectedType: PluginMessageType
  resolve(message: PluginToHostMessage): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface ReadyWaiter {
  resolve(): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface UIRegistration {
  slot: string
  contribution: unknown
}

const CORRELATED_RESPONSE_TYPES = new Set<PluginMessageType>([
  'activated',
  'deactivated',
  'installed',
  'updated',
  'uninstalled',
  'commands.invoke.result',
  'workItems.list.result',
  'workItems.get.result',
  'workItems.updateStatus.result',
  'workItems.addComment.result',
  'workItems.getTransitions.result',
  'workItems.transition.result',
  'workItems.create.result',
])

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class PluginHost {
  private proc: SandboxedPluginProcess | null = null
  private port: Electron.MessagePortMain | null = null
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly eventListeners = new Map<string, () => void>()
  private readonly uiContributions = new Map<string, UIRegistration>()
  private readonly registeredCommands = new Set<string>()
  private readonly pendingResponses = new Map<string, PendingResponse>()
  private readonly expiredResponseIds = new Map<string, number>()
  private readonly rateLimiter = new PluginMessageRateLimiter()
  private readyWaiter: ReadyWaiter | null = null
  private stopping = false
  private unhealthyReported = false
  private readonly workItemOwnership: PluginWorkItemOwnership<WorkItemSource>
  private readonly nativeBroker: PluginNativeProcessBroker
  private readonly brokerAbort = new AbortController()
  private startupId = ''

  constructor(
    private readonly manifest: PluginManifest,
    private readonly pluginSource: string,
    private readonly authority: PluginAuthority,
    private readonly eventBus: EventBus,
    workItemRegistry: WorkItemRegistryFull,
    private webContents?: Electron.WebContents,
    private readonly onStopped?: () => void,
  ) {
    this.workItemOwnership = new PluginWorkItemOwnership(manifest.id, workItemRegistry)
    this.nativeBroker = new PluginNativeProcessBroker(authority)
  }

  async spawn(): Promise<void> {
    if (this.proc || this.port) throw new Error(`Plugin ${this.manifest.id} is already running`)
    this.stopping = false
    this.unhealthyReported = false
    this.startupId = randomUUID()
    const { port1, port2 } = new MessageChannelMain()
    const child = new SandboxedPluginProcess(this.manifest.id, this.pluginSource, this.startupId)
    this.proc = child
    this.port = port1

    port1.on('message', (event) => this.receivePluginMessage(event.data))
    port1.start()
    child.on('exit', (code: number) => this.handleProcessExit(child, code))

    const ready = this.waitForReady()
    try {
      await child.start()
      child.transferPort(port2)
      child.startPlugin()
      await ready
    } catch (error) {
      this.terminateUnhealthy(`Failed to start: ${errorMessage(error)}`)
      throw error
    }
  }

  async activate(config: Record<string, unknown>): Promise<void> {
    await this.runLifecycle('activate', 'activated', { config }, 30_000)
    this.eventBus.emit('plugin.activated', { pluginId: this.manifest.id })
  }

  setWebContents(webContents: Electron.WebContents): void {
    this.webContents = webContents
    const flush = () => {
      for (const [registrationId, { slot, contribution }] of this.uiContributions) {
        if (!webContents.isDestroyed()) {
          webContents.send('plugin:ui-contribution', {
            action: 'add',
            pluginId: this.manifest.id,
            registrationId,
            slot,
            contribution,
          })
        }
      }
    }
    if (webContents.isLoading()) webContents.once('did-finish-load', flush)
    else flush()
  }

  async deactivate(): Promise<void> {
    this.stopping = true
    try {
      if (this.port) await this.sendLifecycle('deactivate', 'deactivated', {}, 5_000)
    } catch (error) {
      console.warn(`[plugin:${this.manifest.id}] deactivation did not complete: ${errorMessage(error)}`)
    } finally {
      this.stopProcess(new Error('Plugin deactivated'))
      this.eventBus.emit('plugin.deactivated', { pluginId: this.manifest.id })
    }
  }

  async install(): Promise<void> {
    await this.runLifecycle('install', 'installed', {}, 10_000)
  }

  async update(previousVersion: string): Promise<void> {
    await this.runLifecycle('update', 'updated', { previousVersion }, 10_000)
  }

  async uninstall(): Promise<void> {
    if (!this.port) return
    await this.runLifecycle('uninstall', 'uninstalled', {}, 10_000)
  }

  async invokeCommand(commandId: string, args: unknown): Promise<unknown> {
    if (!this.registeredCommands.has(commandId)) {
      throw new Error(`Provider command is not available: ${commandId}`)
    }
    assertBoundedStructuredValue(args, PLUGIN_PROTOCOL_LIMITS.commandResultBytes, 'Command arguments')
    const id = randomUUID()
    const message = await this.requestPlugin(
      { type: 'commands.invoke', id, commandId, args },
      'commands.invoke.result',
      30_000,
    )
    if (message.type !== 'commands.invoke.result') throw new Error('Invalid command response')
    return message.result
  }

  private async runLifecycle(
    requestType: 'activate' | 'install' | 'update' | 'uninstall',
    responseType: 'activated' | 'installed' | 'updated' | 'uninstalled',
    fields: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    try {
      await this.sendLifecycle(requestType, responseType, fields, timeoutMs)
    } catch (error) {
      this.terminateUnhealthy(`${requestType} failed: ${errorMessage(error)}`)
      throw error
    }
  }

  private async sendLifecycle(
    requestType: 'activate' | 'deactivate' | 'install' | 'update' | 'uninstall',
    responseType: 'activated' | 'deactivated' | 'installed' | 'updated' | 'uninstalled',
    fields: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<void> {
    const id = randomUUID()
    const response = await this.requestPlugin(
      { type: requestType, id, ...fields } as HostRequestMessage,
      responseType,
      timeoutMs,
    )
    if (response.type !== responseType) throw new Error(`Invalid ${requestType} acknowledgement`)
  }

  private waitForReady(timeoutMs = 10_000): Promise<void> {
    if (this.readyWaiter) throw new Error('Already waiting for plugin readiness')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.readyWaiter = null
        reject(new Error('Timeout waiting for ready'))
      }, timeoutMs)
      this.readyWaiter = { resolve, reject, timer }
    })
  }

  private requestPlugin(
    message: HostRequestMessage,
    expectedType: PluginMessageType,
    timeoutMs: number,
  ): Promise<PluginToHostMessage> {
    const port = this.port
    if (!port) return Promise.reject(new Error('Provider not available'))
    assertResourceCapacity('pending request', this.pendingResponses.size, PLUGIN_HOST_LIMITS.pendingRequests)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(message.id)
        this.rememberExpiredResponse(message.id)
        reject(new Error(`Timeout waiting for ${expectedType}`))
      }, timeoutMs)
      this.pendingResponses.set(message.id, { expectedType, resolve, reject, timer })
      try {
        port.postMessage(message)
      } catch (error) {
        clearTimeout(timer)
        this.pendingResponses.delete(message.id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private receivePluginMessage(raw: unknown): void {
    if (!this.rateLimiter.accept()) {
      this.terminateUnhealthy('Protocol violation: message rate limit exceeded')
      return
    }

    let message: PluginToHostMessage
    try {
      message = parsePluginToHostMessage(raw)
    } catch (error) {
      this.terminateUnhealthy(`Protocol violation: ${errorMessage(error)}`)
      return
    }

    try {
      if (this.routeControlMessage(message)) return
      this.handlePluginMessage(message)
    } catch (error) {
      console.error(`[plugin:${this.manifest.id}] message handling failed:`, error)
      this.deny(message.id, `Host rejected message: ${errorMessage(error)}`)
    }
  }

  private routeControlMessage(message: PluginToHostMessage): boolean {
    if (message.type === 'runtime.error') {
      this.terminateUnhealthy(`${message.phase}: ${message.error}`)
      return true
    }
    if (message.type === 'ready') {
      const waiter = this.readyWaiter
      if (!waiter) {
        this.terminateUnhealthy('Protocol violation: unexpected ready acknowledgement')
        return true
      }
      if (message.id !== this.startupId) {
        this.terminateUnhealthy('Protocol violation: ready startup ID mismatch')
        return true
      }
      this.readyWaiter = null
      clearTimeout(waiter.timer)
      if (message.error) waiter.reject(new Error(message.error))
      else waiter.resolve()
      return true
    }
    if (!CORRELATED_RESPONSE_TYPES.has(message.type)) return false

    const pending = this.pendingResponses.get(message.id)
    if (!pending) {
      if (this.isRecentlyExpired(message.id)) return true
      this.terminateUnhealthy(`Protocol violation: unsolicited ${message.type} response`)
      return true
    }
    if (pending.expectedType !== message.type) {
      this.pendingResponses.delete(message.id)
      clearTimeout(pending.timer)
      pending.reject(new Error(`Expected ${pending.expectedType}, received ${message.type}`))
      this.terminateUnhealthy(`Protocol violation: mismatched response for ${message.id}`)
      return true
    }
    this.pendingResponses.delete(message.id)
    clearTimeout(pending.timer)
    if ('error' in message && message.error) pending.reject(new Error(message.error))
    else pending.resolve(message)
    return true
  }

  private handlePluginMessage(message: PluginToHostMessage): void {
    const db = getRawSqlite()
    const pluginId = this.manifest.id

    switch (message.type) {
      case 'storage.get': {
        const row = db.prepare('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?')
          .get(pluginId, message.key) as { value: string } | undefined
        this.respond(message.id, row ? JSON.parse(row.value) as unknown : undefined)
        break
      }
      case 'storage.set': {
        this.assertStorageCapacity(message.key, message.value)
        db.prepare('INSERT OR REPLACE INTO plugin_storage (plugin_id, key, value) VALUES (?, ?, ?)')
          .run(pluginId, message.key, message.value)
        this.respond(message.id)
        break
      }
      case 'storage.delete':
        db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?').run(pluginId, message.key)
        this.respond(message.id)
        break
      case 'storage.list': {
        const rows = db.prepare('SELECT key FROM plugin_storage WHERE plugin_id = ? LIMIT ?')
          .all(pluginId, PLUGIN_HOST_LIMITS.storageEntries + 1) as { key: string }[]
        if (rows.length > PLUGIN_HOST_LIMITS.storageEntries) throw new Error('Plugin storage entry limit exceeded')
        this.respond(message.id, rows.map((row) => row.key))
        break
      }

      case 'projects.list': {
        if (!this.hasPermission('projects')) { this.deny(message.id, 'Missing projects permission'); break }
        void Promise.all(recentProjectsStore.list().map(async (project) => {
          const detected = await detectRemoteSources(project.path)
          const remotes = detected.length > 0
            ? detected.map((remote) => ({
                name: remote.remote,
                url: remote.url,
                provider: remote.type,
                repository: remote.repo,
              }))
            : project.remotes
          return { path: project.path, name: project.name, remotes }
        })).then((projects) => this.respond(message.id, projects), (error: unknown) => this.deny(message.id, errorMessage(error)))
        break
      }

      case 'environment.get':
        if (!this.hasPermission('environment')) { this.deny(message.id, 'Missing environment permission'); break }
        if (!this.authority.environmentNames.includes(message.name)) {
          this.deny(message.id, `Environment variable is not declared: ${message.name}`)
          break
        }
        this.respond(message.id, process.env[message.name])
        break

      case 'secrets.get':
        if (!this.hasPermission('secrets')) { this.deny(message.id, 'Missing secrets permission'); break }
        void keytar.getPassword(`agentkeeper:${pluginId}`, message.key)
          .then((value) => this.respond(message.id, value ?? undefined), (error: unknown) => this.deny(message.id, errorMessage(error)))
        break
      case 'secrets.set':
        if (!this.hasPermission('secrets')) { this.deny(message.id, 'Missing secrets permission'); break }
        void keytar.setPassword(`agentkeeper:${pluginId}`, message.key, message.value)
          .then(() => this.respond(message.id), (error: unknown) => this.deny(message.id, errorMessage(error)))
        break
      case 'secrets.delete':
        if (!this.hasPermission('secrets')) { this.deny(message.id, 'Missing secrets permission'); break }
        void keytar.deletePassword(`agentkeeper:${pluginId}`, message.key)
          .then(() => this.respond(message.id), (error: unknown) => this.deny(message.id, errorMessage(error)))
        break

      case 'events.emit':
        try {
          const normalized = normalizePluginEmittedEvent(pluginId, message.event, message.payload)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(this.eventBus.emit as (event: string, payload: unknown) => void)(normalized.event, normalized.payload)
        } catch (error) {
          console.warn(`[plugin:${pluginId}] ${errorMessage(error)}`)
        }
        break
      case 'events.on': {
        try {
          filterPluginSubscription(pluginId, message.event, { pluginId })
        } catch (error) {
          this.deny(message.id, errorMessage(error))
          break
        }
        const previous = this.eventListeners.get(message.listenerId)
        if (previous) {
          previous()
          this.eventListeners.delete(message.listenerId)
        } else {
          assertResourceCapacity('event listener', this.eventListeners.size, PLUGIN_HOST_LIMITS.eventListeners)
        }
        const handler = (payload: unknown): void => {
          try {
            const scopedPayload = filterPluginSubscription(pluginId, message.event, payload)
            if (scopedPayload === undefined) return
            this.postToPlugin({
              type: 'events.dispatch',
              listenerId: message.listenerId,
              event: message.event,
              payload: scopedPayload,
            })
          } catch (error) {
            console.warn(`[plugin:${pluginId}] event dispatch rejected: ${errorMessage(error)}`)
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const unsubscribe = (this.eventBus.on as (event: string, handler: (payload: unknown) => void) => () => void)(message.event, handler)
        this.eventListeners.set(message.listenerId, unsubscribe)
        this.respond(message.id)
        break
      }
      case 'events.off': {
        const unsubscribe = this.eventListeners.get(message.listenerId)
        unsubscribe?.()
        this.eventListeners.delete(message.listenerId)
        this.respond(message.id)
        break
      }

      case 'workItems.register':
        if (!this.hasPermission('workItems')) { this.deny(message.id, 'Missing workItems permission'); break }
        try {
          this.workItemOwnership.register(this.createWorkItemProxy(message.sourceId))
          this.respond(message.id)
        } catch (error) {
          this.deny(message.id, errorMessage(error))
        }
        break
      case 'workItems.unregister':
        if (!this.hasPermission('workItems')) { this.deny(message.id, 'Missing workItems permission'); break }
        try {
          this.workItemOwnership.unregister(message.sourceId)
          this.respond(message.id)
        } catch (error) {
          this.deny(message.id, errorMessage(error))
        }
        break

      case 'logger.debug': console.debug(`[plugin:${pluginId}]`, message.message, ...message.args); break
      case 'logger.info': console.info(`[plugin:${pluginId}]`, message.message, ...message.args); break
      case 'logger.warn': console.warn(`[plugin:${pluginId}]`, message.message, ...message.args); break
      case 'logger.error': console.error(`[plugin:${pluginId}]`, message.message, ...message.args); break

      case 'background.every':
        if (!this.hasPermission('background')) { this.deny(message.id, 'Missing background permission'); break }
        assertBackgroundDelay('interval', message.intervalMs)
        this.replaceTimer(message.taskId, () => {
          const timer = setInterval(() => this.postToPlugin({ type: 'background.tick', taskId: message.taskId }), message.intervalMs)
          return timer
        })
        this.respond(message.id)
        break
      case 'background.once':
        if (!this.hasPermission('background')) { this.deny(message.id, 'Missing background permission'); break }
        assertBackgroundDelay('delay', message.delayMs)
        this.replaceTimer(message.taskId, () => setTimeout(() => {
          this.timers.delete(message.taskId)
          this.postToPlugin({ type: 'background.tick', taskId: message.taskId })
        }, message.delayMs))
        this.respond(message.id)
        break
      case 'background.cancel':
        this.clearTimer(message.taskId)
        this.respond(message.id)
        break

      case 'ui.contribute':
        if (!this.hasPermission('ui')) { this.deny(message.id, 'Missing ui permission'); break }
        if (!this.uiContributions.has(message.registrationId)) {
          assertResourceCapacity('UI contribution', this.uiContributions.size, PLUGIN_HOST_LIMITS.uiContributions)
        }
        this.uiContributions.set(message.registrationId, { slot: message.slot, contribution: message.contribution })
        this.sendUiContribution({
          action: 'add',
          pluginId,
          registrationId: message.registrationId,
          slot: message.slot,
          contribution: message.contribution,
        })
        this.respond(message.id)
        break
      case 'ui.remove':
        this.uiContributions.delete(message.registrationId)
        this.sendUiContribution({ action: 'remove', pluginId, registrationId: message.registrationId })
        this.respond(message.id)
        break

      case 'commands.register':
        if (!this.hasPermission('commands')) { this.deny(message.id, 'Missing commands permission'); break }
        if (!this.registeredCommands.has(message.commandId)) {
          assertResourceCapacity('command', this.registeredCommands.size, PLUGIN_HOST_LIMITS.commands)
        }
        this.registeredCommands.add(message.commandId)
        this.respond(message.id)
        break
      case 'commands.unregister':
        this.registeredCommands.delete(message.commandId)
        this.respond(message.id)
        break

      case 'network.fetch':
        void fetchForPlugin(this.authority, { url: message.url, init: message.init }, this.brokerAbort.signal)
          .then(result => this.respond(message.id, result), error => this.deny(message.id, errorMessage(error)))
        break
      case 'nativeProcess.execFile':
        void this.nativeBroker.exec(message.id, { file: message.file, args: message.args, options: message.options })
          .then(result => this.respond(message.id, result), error => this.deny(message.id, errorMessage(error)))
        break

      default:
        // Lifecycle and result messages are consumed by routeControlMessage.
        break
    }
  }

  private createWorkItemProxy(sourceId: string): WorkItemSource {
    return {
      id: sourceId,
      label: sourceId,
      list: async () => {
        const id = randomUUID()
        const message = await this.requestPlugin({ type: 'workItems.list', id }, 'workItems.list.result', 10_000)
        if (message.type !== 'workItems.list.result' || !message.items) return this.invalidResult('Missing work-item list')
        this.assertOwnedItems(sourceId, message.items)
        return message.items as WorkItem[]
      },
      get: async (itemId) => {
        const id = randomUUID()
        const message = await this.requestPlugin({ type: 'workItems.get', id, itemId }, 'workItems.get.result', 10_000)
        if (message.type !== 'workItems.get.result') return this.invalidResult('Invalid work-item response')
        if (message.item) this.assertOwnedItems(sourceId, [message.item])
        return message.item as WorkItem | undefined
      },
      updateStatus: async (itemId, status) => {
        const id = randomUUID()
        await this.requestPlugin({ type: 'workItems.updateStatus', id, itemId, status }, 'workItems.updateStatus.result', 10_000)
      },
      addComment: async (itemId, comment) => {
        const id = randomUUID()
        await this.requestPlugin({ type: 'workItems.addComment', id, itemId, comment }, 'workItems.addComment.result', 10_000)
      },
      getTransitions: async (itemId) => {
        const id = randomUUID()
        const message = await this.requestPlugin({ type: 'workItems.getTransitions', id, itemId }, 'workItems.getTransitions.result', 10_000)
        if (message.type !== 'workItems.getTransitions.result' || !message.transitions) return this.invalidResult('Missing transition list')
        return message.transitions as IssueTransition[]
      },
      transition: async (itemId, transitionId) => {
        const id = randomUUID()
        await this.requestPlugin({ type: 'workItems.transition', id, itemId, transitionId }, 'workItems.transition.result', 10_000)
      },
      create: async (fields) => {
        const id = randomUUID()
        const message = await this.requestPlugin({ type: 'workItems.create', id, fields }, 'workItems.create.result', 10_000)
        if (message.type !== 'workItems.create.result' || !message.item) return this.invalidResult('Missing created work item')
        this.assertOwnedItems(sourceId, [message.item])
        return message.item as WorkItem
      },
    }
  }

  private assertOwnedItems(sourceId: string, items: Array<{ source: string }>): void {
    if (items.some((item) => item.source !== sourceId)) {
      this.invalidResult(`Work-item result escaped source ${sourceId}`)
    }
  }

  private invalidResult(reason: string): never {
    this.terminateUnhealthy(`Protocol violation: ${reason}`)
    throw new Error(reason)
  }

  private assertStorageCapacity(key: string, value: string): void {
    const db = getRawSqlite()
    const rows = db.prepare('SELECT key, value FROM plugin_storage WHERE plugin_id = ?').all(this.manifest.id) as Array<{ key: string; value: string }>
    const withoutCurrent = rows.filter((row) => row.key !== key)
    if (withoutCurrent.length >= PLUGIN_HOST_LIMITS.storageEntries) {
      throw new Error(`Plugin storage entry limit reached (${PLUGIN_HOST_LIMITS.storageEntries})`)
    }
    const bytes = withoutCurrent.reduce((total, row) => total + Buffer.byteLength(row.key) + Buffer.byteLength(row.value), 0)
      + Buffer.byteLength(key) + Buffer.byteLength(value)
    if (bytes > PLUGIN_HOST_LIMITS.storageTotalBytes) {
      throw new Error(`Plugin storage exceeds ${PLUGIN_HOST_LIMITS.storageTotalBytes} bytes`)
    }
  }

  private replaceTimer(taskId: string, create: () => ReturnType<typeof setTimeout>): void {
    const existing = this.timers.get(taskId)
    if (existing) clearTimeout(existing)
    else assertResourceCapacity('background task', this.timers.size, PLUGIN_HOST_LIMITS.backgroundTasks)
    this.timers.set(taskId, create())
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId)
    if (timer) clearTimeout(timer)
    this.timers.delete(taskId)
  }

  private hasPermission(permission: PluginPermission): boolean {
    return this.authority.permissions.includes(permission)
  }

  private postToPlugin(message: HostToPluginMessage): void {
    try {
      this.port?.postMessage(message)
    } catch (error) {
      this.terminateUnhealthy(`Message delivery failed: ${errorMessage(error)}`)
    }
  }

  private deny(id: string, reason: string): void {
    this.postToPlugin({ type: 'response', id, error: reason.slice(0, 4_096) })
  }

  private respond(id: string, result?: unknown): void {
    this.postToPlugin({ type: 'response', id, result })
  }

  private sendUiContribution(payload: Record<string, unknown>): void {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('plugin:ui-contribution', payload)
    }
  }

  private rememberExpiredResponse(id: string): void {
    const now = Date.now()
    this.expiredResponseIds.set(id, now + 60_000)
    if (this.expiredResponseIds.size > 256) {
      const oldest = this.expiredResponseIds.keys().next().value as string | undefined
      if (oldest) this.expiredResponseIds.delete(oldest)
    }
  }

  private isRecentlyExpired(id: string): boolean {
    const now = Date.now()
    for (const [candidate, expires] of this.expiredResponseIds) {
      if (expires <= now) this.expiredResponseIds.delete(candidate)
    }
    return this.expiredResponseIds.has(id)
  }

  private handleProcessExit(child: SandboxedPluginProcess, code: number | null): void {
    if (this.proc !== child) return
    this.proc = null
    this.port = null
    this.cleanupRuntime(new Error(`Plugin process exited${code === null ? '' : ` with code ${code}`}`))
    if (!this.stopping) this.markUnhealthy(`Process exited${code === null ? '' : ` with code ${code}`}`)
  }

  private terminateUnhealthy(reason: string): void {
    this.markUnhealthy(reason)
    this.stopProcess(new Error(reason))
  }

  private markUnhealthy(reason: string): void {
    if (this.unhealthyReported) return
    this.unhealthyReported = true
    console.error(`[plugin:${this.manifest.id}] ${reason}`)
    try {
      this.eventBus.emit('plugin.unhealthy', { pluginId: this.manifest.id, reason })
    } catch (error) {
      console.error(`[plugin:${this.manifest.id}] could not emit unhealthy event:`, error)
    }
    try {
      getRawSqlite().prepare('UPDATE plugin_registry SET enabled = 0 WHERE id = ?').run(this.manifest.id)
    } catch (error) {
      console.error(`[plugin:${this.manifest.id}] could not persist unhealthy state:`, error)
    }
  }

  private stopProcess(reason: Error): void {
    const child = this.proc
    const port = this.port
    this.proc = null
    this.port = null
    this.cleanupRuntime(reason)
    try { port?.close() } catch { /* already closed */ }
    try { child?.kill() } catch { /* already exited */ }
  }

  private cleanupRuntime(reason: Error): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    for (const unsubscribe of this.eventListeners.values()) {
      try { unsubscribe() } catch (error) { console.warn(`[plugin:${this.manifest.id}] listener cleanup failed:`, error) }
    }
    this.eventListeners.clear()
    this.registeredCommands.clear()
    this.uiContributions.clear()
    this.workItemOwnership.dispose()

    if (this.readyWaiter) {
      clearTimeout(this.readyWaiter.timer)
      this.readyWaiter.reject(reason)
      this.readyWaiter = null
    }
    for (const pending of this.pendingResponses.values()) {
      clearTimeout(pending.timer)
      pending.reject(reason)
    }
    this.pendingResponses.clear()
    this.expiredResponseIds.clear()
    this.brokerAbort.abort(reason)
    this.nativeBroker.stopAll()
    this.onStopped?.()
  }
}
