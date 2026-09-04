import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const PORT_CHANNEL = 'agentkeeper:plugin-sandbox-port'
const START_CHANNEL = 'agentkeeper:plugin-sandbox-start'

type MessageHandler = (message: unknown) => void
type StartPayload = { pluginId: string; pluginSource: string; runtimeSource: string; startupId: string }

let hostPort: MessagePort | null = null
const hostMessageHandlers = new Set<MessageHandler>()
const startHandlers = new Set<(payload: StartPayload) => void>()
const queuedStarts: StartPayload[] = []
const queuedHostMessages: unknown[] = []

ipcRenderer.on(PORT_CHANNEL, (event: IpcRendererEvent) => {
  const port = event.ports[0]
  if (!port) return
  hostPort?.close()
  hostPort = port
  port.onmessage = (message) => {
    for (const handler of hostMessageHandlers) handler(message.data)
  }
  port.start()
  for (const message of queuedHostMessages.splice(0)) port.postMessage(message)
})

ipcRenderer.on(START_CHANNEL, (_event: IpcRendererEvent, payload: StartPayload) => {
  if (startHandlers.size === 0) {
    if (queuedStarts.length >= 1) throw new Error('Plugin sandbox start queue overflow')
    queuedStarts.push(payload)
    return
  }
  for (const handler of startHandlers) handler(payload)
})

contextBridge.exposeInMainWorld('__agentkeeperPluginSandbox', {
  send(message: unknown): void {
    if (hostPort) hostPort.postMessage(message)
    else {
      if (queuedHostMessages.length >= 32) throw new Error('Plugin sandbox host queue overflow')
      queuedHostMessages.push(message)
    }
  },
  onMessage(handler: MessageHandler): () => void {
    hostMessageHandlers.add(handler)
    return () => hostMessageHandlers.delete(handler)
  },
  onStart(handler: (payload: StartPayload) => void): () => void {
    startHandlers.add(handler)
    for (const payload of queuedStarts.splice(0)) handler(payload)
    return () => startHandlers.delete(handler)
  },
})
