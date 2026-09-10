/**
 * Runs inside a dedicated browser Worker. Keep this source self-contained: it
 * is serialized into the sandbox page and deliberately has no Node imports.
 */
function pluginWorkerRuntime(): void {
  const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> }>()
  const listeners = new Map<string, (payload: unknown) => void | Promise<void>>()
  const taskHandlers = new Map<string, () => void | Promise<void>>()
  const workItemProviders = new Map<string, Record<string, (...args: never[]) => unknown>>()
  const commandHandlers = new Map<string, (args: unknown) => unknown | Promise<unknown>>()
  let plugin: Record<string, (...args: never[]) => unknown> | null = null

  function makeId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }

  function fireToHost(message: Record<string, unknown>): void {
    globalThis.postMessage(message)
  }

  function sendToHost(message: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(String(message.id))
        reject(new Error(`Plugin host request timed out: ${String(message.type)}`))
      }, timeoutMs)
      pending.set(String(message.id), { resolve, reject, timeout })
      fireToHost(message)
    })
  }

  function reportRuntimeError(phase: string, error: unknown): void {
    fireToHost({
      id: makeId(),
      type: 'runtime.error',
      phase: phase.slice(0, 128),
      error: (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 4_096),
    })
  }

  const storage = {
    get: (key: string) => sendToHost({ id: makeId(), type: 'storage.get', key }),
    async set(key: string, value: unknown): Promise<void> {
      await sendToHost({ id: makeId(), type: 'storage.set', key, value: JSON.stringify(value) })
    },
    delete: (key: string) => sendToHost({ id: makeId(), type: 'storage.delete', key }),
    async list(prefix?: string): Promise<string[]> {
      const keys = await sendToHost({ id: makeId(), type: 'storage.list' }) as string[]
      return prefix ? keys.filter(key => key.startsWith(prefix)) : keys
    },
  }

  const secrets = {
    get: (key: string) => sendToHost({ id: makeId(), type: 'secrets.get', key }),
    set: (key: string, value: string) => sendToHost({ id: makeId(), type: 'secrets.set', key, value }),
    delete: (key: string) => sendToHost({ id: makeId(), type: 'secrets.delete', key }),
  }

  const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [
    level,
    (message: string, meta?: unknown) => fireToHost({
      id: makeId(),
      type: `logger.${level}`,
      message,
      args: meta === undefined ? [] : [meta],
    }),
  ]))

  const events = {
    emit(event: string, payload: unknown): void {
      fireToHost({ id: makeId(), type: 'events.emit', event, payload })
    },
    on(event: string, handler: (payload: unknown) => void | Promise<void>): () => void {
      const listenerId = makeId()
      listeners.set(listenerId, handler)
      void sendToHost({ id: makeId(), type: 'events.on', event, listenerId })
      return () => {
        listeners.delete(listenerId)
        void sendToHost({ id: makeId(), type: 'events.off', listenerId }).catch(() => {})
      }
    },
  }

  const workItems = {
    register(source: Record<string, (...args: never[]) => unknown> & { id: string }): void {
      workItemProviders.set(source.id, source)
      fireToHost({ id: makeId(), type: 'workItems.register', sourceId: source.id })
    },
    unregister(sourceId: string): void {
      workItemProviders.delete(sourceId)
      fireToHost({ id: makeId(), type: 'workItems.unregister', sourceId })
    },
  }

  const ui = {
    contribute(slot: string, contribution: unknown): () => void {
      const registrationId = makeId()
      fireToHost({ id: makeId(), type: 'ui.contribute', registrationId, slot, contribution })
      return () => fireToHost({ id: makeId(), type: 'ui.remove', registrationId })
    },
  }

  const commands = {
    register(command: { id: string; label: string; handler(args: unknown): unknown | Promise<unknown> }): () => void {
      commandHandlers.set(command.id, command.handler)
      fireToHost({ id: makeId(), type: 'commands.register', commandId: command.id, label: command.label })
      return () => {
        commandHandlers.delete(command.id)
        fireToHost({ id: makeId(), type: 'commands.unregister', commandId: command.id })
      }
    },
  }

  const background = {
    every(intervalMs: number, handler: () => void | Promise<void>): () => void {
      const taskId = makeId()
      taskHandlers.set(taskId, handler)
      fireToHost({ id: makeId(), type: 'background.every', intervalMs, taskId })
      return () => {
        taskHandlers.delete(taskId)
        fireToHost({ id: makeId(), type: 'background.cancel', taskId })
      }
    },
    once(handler: () => void | Promise<void>, options?: { delayMs?: number }): () => void {
      const taskId = makeId()
      taskHandlers.set(taskId, handler)
      fireToHost({ id: makeId(), type: 'background.once', delayMs: options?.delayMs ?? 0, taskId })
      return () => {
        taskHandlers.delete(taskId)
        fireToHost({ id: makeId(), type: 'background.cancel', taskId })
      }
    },
  }

  const projects = {
    list: () => sendToHost({ id: makeId(), type: 'projects.list' }),
  }

  const environment = {
    get: (name: string) => sendToHost({ id: makeId(), type: 'environment.get', name }),
  }

  const nativeProcess = {
    execFile(file: string, args: string[] = [], options: Record<string, unknown> = {}) {
      return sendToHost({ id: makeId(), type: 'nativeProcess.execFile', file, args, options }, 125_000)
    },
  }

  async function brokeredFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const request = new Request(input, init)
    const body = request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()
    const result = await sendToHost({
      id: makeId(),
      type: 'network.fetch',
      url: request.url,
      init: {
        method: request.method,
        headers: Array.from(request.headers.entries()),
        ...(body && body.byteLength > 0 ? { body } : {}),
      },
    }) as { body?: ArrayBuffer; headers?: [string, string][]; status: number; statusText?: string }
    return new Response(result.body, {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
    })
  }

  const context: Record<string, unknown> = {
    config: {},
    logger,
    storage,
    secrets,
    environment,
    events,
    workItems,
    ui,
    commands,
    background,
    projects,
    process: nativeProcess,
    fetch: brokeredFetch,
  }

  async function invokeSource(method: string, args: unknown[]): Promise<unknown> {
    const source = workItemProviders.values().next().value as Record<string, (...args: never[]) => unknown> | undefined
    const handler = source?.[method]
    return handler ? handler.apply(source, args as never[]) : undefined
  }

  async function handleHostMessage(message: Record<string, unknown>): Promise<void> {
    if (message.type === 'response') {
      const request = pending.get(String(message.id))
      if (!request) return
      pending.delete(String(message.id))
      clearTimeout(request.timeout)
      if (message.error) request.reject(new Error(String(message.error)))
      else request.resolve(message.result)
      return
    }

    if (message.type === 'activate') {
      context.config = message.config ?? {}
      await plugin?.activate?.(context as never)
      fireToHost({ id: message.id, type: 'activated' })
      return
    }
    if (message.type === 'deactivate') {
      await plugin?.deactivate?.()
      fireToHost({ id: message.id, type: 'deactivated' })
      return
    }
    if (message.type === 'install') {
      await plugin?.onInstall?.(context as never)
      fireToHost({ id: message.id, type: 'installed' })
      return
    }
    if (message.type === 'update') {
      await plugin?.onUpdate?.(context as never, message.previousVersion as never)
      fireToHost({ id: message.id, type: 'updated' })
      return
    }
    if (message.type === 'uninstall') {
      await plugin?.onUninstall?.(context as never)
      fireToHost({ id: message.id, type: 'uninstalled' })
      return
    }
    if (message.type === 'background.tick') {
      await taskHandlers.get(String(message.taskId))?.()
      return
    }
    if (message.type === 'events.dispatch') {
      await listeners.get(String(message.listenerId))?.(message.payload)
      return
    }

    const workItemResultTypes: Record<string, string> = {
      'workItems.list': 'workItems.list.result',
      'workItems.get': 'workItems.get.result',
      'workItems.updateStatus': 'workItems.updateStatus.result',
      'workItems.addComment': 'workItems.addComment.result',
      'workItems.getTransitions': 'workItems.getTransitions.result',
      'workItems.transition': 'workItems.transition.result',
      'workItems.create': 'workItems.create.result',
    }
    const workItemResultType = workItemResultTypes[String(message.type)]
    if (workItemResultType) {
      try {
        let result: unknown
        if (message.type === 'workItems.list') result = await invokeSource('list', [])
        if (message.type === 'workItems.get') result = await invokeSource('get', [message.itemId])
        if (message.type === 'workItems.updateStatus') result = await invokeSource('updateStatus', [message.itemId, message.status])
        if (message.type === 'workItems.addComment') result = await invokeSource('addComment', [message.itemId, message.comment])
        if (message.type === 'workItems.getTransitions') result = await invokeSource('getTransitions', [message.itemId])
        if (message.type === 'workItems.transition') result = await invokeSource('transition', [message.itemId, message.transitionId])
        if (message.type === 'workItems.create') result = await invokeSource('create', [message.fields])
        const payloadKey = message.type === 'workItems.list' ? 'items'
          : message.type === 'workItems.getTransitions' ? 'transitions'
            : message.type === 'workItems.get' || message.type === 'workItems.create' ? 'item'
              : null
        fireToHost({ id: message.id, type: workItemResultType, ...(payloadKey ? { [payloadKey]: result ?? (payloadKey === 'item' ? undefined : []) } : {}) })
      } catch (error) {
        fireToHost({ id: message.id, type: workItemResultType, error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (message.type === 'commands.invoke') {
      const handler = commandHandlers.get(String(message.commandId))
      if (!handler) {
        fireToHost({ id: message.id, type: 'commands.invoke.result', error: `Unknown command: ${String(message.commandId)}` })
        return
      }
      try {
        fireToHost({ id: message.id, type: 'commands.invoke.result', result: await handler(message.args) })
      } catch (error) {
        fireToHost({ id: message.id, type: 'commands.invoke.result', error: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  globalThis.onmessage = (event: MessageEvent) => {
    const message = event.data as Record<string, unknown>
    if (message?.type === 'sandbox.bootstrap') {
      void (async () => {
        const pluginUrl = URL.createObjectURL(new Blob([String(message.pluginSource)], { type: 'text/javascript' }))
        try {
          ;(globalThis as typeof globalThis & { importScripts(url: string): void }).importScripts(pluginUrl)
          const loaded = (globalThis as typeof globalThis & {
            AgentKeeperPluginModule?: { default?: Record<string, (...args: never[]) => unknown> }
          }).AgentKeeperPluginModule
          if (!loaded?.default || typeof loaded.default.activate !== 'function') throw new Error('Plugin entry must expose a default activate() function')
          plugin = loaded.default
          delete (globalThis as typeof globalThis & { AgentKeeperPluginModule?: unknown }).AgentKeeperPluginModule
          fireToHost({ id: String(message.startupId), type: 'ready' })
        } finally {
          URL.revokeObjectURL(pluginUrl)
        }
      })().catch(error => reportRuntimeError('bootstrap', error))
      return
    }
    void handleHostMessage(message).catch(error => reportRuntimeError(String(message?.type ?? 'message'), error))
  }
}

export const PLUGIN_WORKER_RUNTIME_SOURCE = `(${pluginWorkerRuntime.toString()})();\n//# sourceURL=agentkeeper-plugin-runtime.js`
