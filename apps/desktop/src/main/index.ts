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

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const registry = await activatePlugins(app)
  setWorkItemRegistry(registry)
  registerIpcHandlers(registry)
  const win = createWindow()
  wirePluginEventRelay(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
