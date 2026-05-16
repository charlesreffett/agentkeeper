import { app, BrowserWindow, shell } from 'electron'
// DEV ONLY: enable CDP for agent-browser testing
if (process.env['NODE_ENV'] !== 'production') {
  app.commandLine.appendSwitch('remote-debugging-port', '9223')
}
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers, wirePluginEventRelay } from './ipc'
import { activatePlugins } from './plugins'
import { setWorkItemRegistry } from './agent'
import { initPricing } from './pricing'
import { init as initCostLedger, flush as flushCostLedger } from './cost-ledger'
import { initDb } from './db/index'
import { runLegacyImport } from './db/legacy-import'
import { pruneOrphanedDrafts } from './drafts'
import { stopAllWatchers, removeSubscriber } from './watcher.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

app.on('before-quit', () => {
  stopAllWatchers()
  flushCostLedger()
})

app.whenReady().then(async () => {
  const userData = app.getPath('userData')
  initDb(userData)
  runLegacyImport(userData)
  pruneOrphanedDrafts()
  initPricing()
  initCostLedger(userData)
  const registry = await activatePlugins(app)
  setWorkItemRegistry(registry)
  registerIpcHandlers(registry)
  const win = createWindow()
  win.webContents.on('destroyed', () => {
    removeSubscriber(win.webContents.id)
  })
  wirePluginEventRelay(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
