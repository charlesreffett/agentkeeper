import { app, BrowserWindow, shell } from 'electron'
// DEV ONLY: enable CDP for agent-browser testing
if (process.env['NODE_ENV'] !== 'production') {
  app.commandLine.appendSwitch('remote-debugging-port', '9223')
}
import path from 'node:path'
import * as net from 'node:net'
import * as fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers, wirePluginEventRelay } from './ipc'
import { activatePlugins, installBundledPlugins, WorkItemRegistryImpl } from './plugins'
import { loadDevPlugin, unloadDevPlugin, clearDevPluginRegistry } from './plugin-manager.js'
import { setWebContentsOnActiveHosts } from './plugin-loader.js'
import { setWorkItemRegistry } from './agent'
import { initPricing } from './pricing'
import { init as initCostLedger, flush as flushCostLedger } from './cost-ledger'
import { initDb } from './db/index'
import { runLegacyImport } from './db/legacy-import'
import { pruneOrphanedDrafts } from './drafts'
import { stopAllWatchers, removeSubscriber } from './watcher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function startCliSocket(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const sockPath = path.join(userDataPath, 'agentkeeper-cli.sock')
  // Remove stale socket
  await fsp.unlink(sockPath).catch(() => {})

  const server = net.createServer((socket) => {
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      let cmd: { cmd: string; dirPath?: string; pluginId?: string }
      try { cmd = JSON.parse(line) } catch { socket.write(JSON.stringify({ ok: false, error: 'invalid JSON' }) + '\n'); return }
      if (cmd.cmd === 'loadDev' && cmd.dirPath) {
        loadDevPlugin(cmd.dirPath)
          .then(() => socket.write(JSON.stringify({ ok: true }) + '\n'))
          .catch((err: Error) => socket.write(JSON.stringify({ ok: false, error: err.message }) + '\n'))
      } else if (cmd.cmd === 'unloadDev' && cmd.pluginId) {
        unloadDevPlugin(cmd.pluginId)
          .then(() => socket.write(JSON.stringify({ ok: true }) + '\n'))
          .catch((err: Error) => socket.write(JSON.stringify({ ok: false, error: err.message }) + '\n'))
      } else {
        socket.write(JSON.stringify({ ok: false, error: `unknown command: ${cmd.cmd}` }) + '\n')
      }
    })
  })
  server.listen(sockPath)
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0b',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://') && !url.startsWith('http://localhost')) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

// macOS: .akp files opened via Finder before the window is ready
let pendingAkpPath: string | null = null
app.on('open-file', (_event, filePath) => {
  if (!filePath.endsWith('.akp')) return
  app.whenReady().then(() => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.webContents.send('plugin:open-file', filePath)
    } else {
      pendingAkpPath = filePath
    }
  })
})

// Windows/Linux: .akp passed as argv in second-instance
app.on('second-instance', (_event, argv) => {
  const akp = argv.find((a) => a.endsWith('.akp'))
  if (!akp) return
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
    win.webContents.send('plugin:open-file', akp)
  }
})

app.on('before-quit', () => {
  stopAllWatchers()
  flushCostLedger()
  clearDevPluginRegistry()
})

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  initDb(userData)
  runLegacyImport(userData)
  pruneOrphanedDrafts()
  initPricing()
  initCostLedger(userData)
  installBundledPlugins()
  const registry = new WorkItemRegistryImpl()
  setWorkItemRegistry(registry)
  await activatePlugins(registry)
  registerIpcHandlers(registry)
  const win = createWindow()
  setWebContentsOnActiveHosts(win.webContents)
  win.webContents.on('destroyed', () => {
    removeSubscriber(win.webContents.id)
  })
  wirePluginEventRelay(win)
  await startCliSocket()

  // Flush any .akp path queued before the window existed (macOS open-file)
  if (pendingAkpPath) {
    const queued = pendingAkpPath
    pendingAkpPath = null
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('plugin:open-file', queued)
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
