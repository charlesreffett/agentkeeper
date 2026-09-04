import { BrowserWindow, session, type MessagePortMain } from 'electron'
import { EventEmitter } from 'node:events'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { PLUGIN_WORKER_RUNTIME_SOURCE } from './plugin-sandbox-runtime.js'

const PORT_CHANNEL = 'agentkeeper:plugin-sandbox-port'
const START_CHANNEL = 'agentkeeper:plugin-sandbox-start'
const MAX_PLUGIN_ENTRY_BYTES = 20 * 1024 * 1024

export const PLUGIN_SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' blob:",
  'worker-src blob:',
  "connect-src 'none'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "webrtc 'block'",
].join('; ')

export function buildPluginSandboxDocument(): string {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${PLUGIN_SANDBOX_CSP}">
  <meta http-equiv="x-dns-prefetch-control" content="off">
</head>
<body>
<script>
(() => {
  'use strict';
  const bridge = window.__agentkeeperPluginSandbox;
  let worker = null;
  bridge.onMessage(message => worker?.postMessage(message));
  bridge.onStart(payload => {
    if (worker) worker.terminate();
    const runtimeUrl = URL.createObjectURL(new Blob([payload.runtimeSource], { type: 'text/javascript' }));
    worker = new Worker(runtimeUrl, { name: 'plugin:' + payload.pluginId });
    URL.revokeObjectURL(runtimeUrl);
    worker.onmessage = event => bridge.send(event.data);
    worker.onerror = event => bridge.send({
      id: crypto.randomUUID(),
      type: 'runtime.error',
      phase: 'worker',
      error: String(event.message || 'Plugin worker failed'),
    });
    worker.postMessage({ type: 'sandbox.bootstrap', pluginSource: payload.pluginSource, startupId: payload.startupId });
  });
})();
</script>
</body>
</html>`
}

export class SandboxedPluginProcess extends EventEmitter {
  private window: BrowserWindow | null = null
  private exited = false

  constructor(
    private readonly pluginId: string,
    private readonly pluginSource: string,
    private readonly startupId: string,
  ) {
    super()
  }

  async start(): Promise<void> {
    if (Buffer.byteLength(this.pluginSource) > MAX_PLUGIN_ENTRY_BYTES) {
      throw new Error(`Plugin backend bundle must be no larger than ${MAX_PLUGIN_ENTRY_BYTES} bytes`)
    }
    const partition = `plugin-sandbox-${this.pluginId}-${randomUUID()}`
    const pluginSession = session.fromPartition(partition, { cache: false })
    pluginSession.setPermissionCheckHandler(() => false)
    pluginSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
    pluginSession.webRequest.onBeforeRequest((details, callback) => {
      let protocol = ''
      try { protocol = new URL(details.url).protocol } catch { /* deny malformed URLs */ }
      callback({ cancel: !['data:', 'blob:'].includes(protocol) })
    })

    const preload = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'preload', 'plugin-sandbox.cjs')
    const win = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload,
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        webviewTag: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
      },
    })
    this.window = win
    win.setMenuBarVisibility(false)
    win.webContents.setAudioMuted(true)
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.on('will-frame-navigate', details => details.preventDefault())
    win.webContents.on('unresponsive', () => this.finish(1))
    win.webContents.on('render-process-gone', (_event, details) => this.finish(details.exitCode ?? 1))
    win.on('closed', () => this.finish(0))

    const html = buildPluginSandboxDocument()
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    if (win.isDestroyed()) throw new Error('Plugin sandbox closed during startup')
  }

  startPlugin(): void {
    const win = this.window
    if (!win || win.isDestroyed()) throw new Error('Plugin sandbox is not running')
    win.webContents.send(START_CHANNEL, {
      pluginId: this.pluginId,
      pluginSource: this.pluginSource,
      runtimeSource: PLUGIN_WORKER_RUNTIME_SOURCE,
      startupId: this.startupId,
    })
  }

  transferPort(port: MessagePortMain): void {
    const win = this.window
    if (!win || win.isDestroyed()) throw new Error('Plugin sandbox is not running')
    win.webContents.postMessage(PORT_CHANNEL, null, [port])
  }

  kill(): boolean {
    const win = this.window
    this.window = null
    if (!win || win.isDestroyed()) return false
    win.destroy()
    return true
  }

  private finish(code: number): void {
    if (this.exited) return
    this.exited = true
    this.window = null
    this.emit('exit', code)
  }
}
