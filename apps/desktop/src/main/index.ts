import { app, BrowserWindow, shell, Menu, dialog } from 'electron'
// DEV ONLY: enable CDP for agent-browser testing. NODE_ENV is commonly unset in
// packaged apps, so use Electron's packaged-state flag as the source of truth.
// The port remains overridable so concurrent development instances can run.
if (!app.isPackaged) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env['AGENTKEEPER_DEBUG_PORT'] ?? '9223',
  )
}
app.name = 'AgentKeeper'
import path from 'node:path'
import * as net from 'node:net'
import * as fsp from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { registerIpcHandlers, wirePluginEventRelay } from './ipc'
import { warmAvailableModels } from './models'
import { warmCapabilities } from './capabilities'
import { initHarnessDefault, harnessRegistry } from './harness'
import { syncMobileServer, teardownMobileServer } from './mobile-server'
import { settingsStore } from './settings'
import { pruneExpiredIfEnabled } from './session-registry'
import { activatePlugins, pruneLegacyBundledPlugins, WorkItemRegistryImpl } from './plugins'
import { loadDevPlugin, unloadDevPlugin, clearDevPluginRegistry } from './plugin-manager.js'
import { setWebContentsOnActiveHosts } from './plugin-loader.js'
import { setWorkItemRegistry } from './agent'
import { initPricing } from './pricing'
import { init as initCostLedger, flush as flushCostLedger } from './cost-ledger'
import { initDb } from './db/index'
import { runLegacyImport } from './db/legacy-import'
import { pruneOrphanedDrafts } from './drafts'
import { stopAllWatchers, removeSubscriber } from './watcher.js'
import { checkForAppUpdate, initializeAppUpdater } from './app-updater'
import { isTrustedRendererNavigation, normalizeExternalUrl } from './navigation-policy'
import { RENDERER_SECURITY_WEB_PREFERENCES } from './renderer-security-policy'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const devUserDataPath = process.env['AGENTKEEPER_USER_DATA_DIR']
if (!app.isPackaged && devUserDataPath) {
  app.setPath('userData', path.resolve(devUserDataPath))
  console.info(`[startup] Using development data directory: ${app.getPath('userData')}`)
}
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

// Interrupting a session tears down the claude subprocess mid-flight; the Agent
// SDK and node's child_process abort plumbing can surface a stray "operation
// aborted" AbortError that no local try/catch is positioned to catch. It is
// benign — swallow it. Registering any uncaughtException handler suppresses
// Electron's built-in crash dialog, so this one has to reproduce that dialog
// for every error that isn't a benign abort.
function isBenignAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}
process.on('uncaughtException', (err) => {
  if (isBenignAbort(err)) {
    console.warn('[main] ignored benign AbortError:', err.message)
    return
  }
  console.error('[main] uncaughtException:', err)
  dialog.showErrorBox(
    'A JavaScript error occurred in the main process',
    err?.stack ?? String(err),
  )
  app.exit(1)
})
process.on('unhandledRejection', (reason) => {
  if (isBenignAbort(reason)) {
    console.warn('[main] ignored benign AbortError rejection:', (reason as Error).message)
    return
  }
  throw reason
})

let cliServer: net.Server | null = null
const externalPromptWindows = new Set<number>()
const externalPromptCooldowns = new Map<number, number>()
const EXTERNAL_PROMPT_COOLDOWN_MS = 10_000

async function confirmOpenExternal(win: BrowserWindow, requestedUrl: string): Promise<void> {
  const target = normalizeExternalUrl(requestedUrl)
  const now = Date.now()
  if (!target || win.isDestroyed() || externalPromptWindows.has(win.id)
    || now < (externalPromptCooldowns.get(win.id) ?? 0)) return

  externalPromptWindows.add(win.id)
  externalPromptCooldowns.set(win.id, now + EXTERNAL_PROMPT_COOLDOWN_MS)
  try {
    const parsed = new URL(target)
    const result = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Cancel', 'Open in browser'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Open external link?',
      message: `Open ${parsed.hostname} in your browser?`,
      detail: target,
    })
    if (result.response === 1) await shell.openExternal(target)
  } catch (error) {
    console.warn('[navigation] failed to open external URL:', error)
  } finally {
    externalPromptWindows.delete(win.id)
  }
}

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
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(sockPath, () => {
      server.off('error', reject)
      server.on('error', (error) => console.error('[cli-socket] server error:', error))
      resolve()
    })
  })
  cliServer = server
}

function createWindow(): BrowserWindow {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  const packagedRendererUrl = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href
  const rendererEntryUrl = devUrl ?? packagedRendererUrl
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
      preload: path.join(__dirname, '../preload/index.cjs'),
      ...RENDERER_SECURITY_WEB_PREFERENCES,
    },
  })

  win.on('ready-to-show', () => win.show())
  win.webContents.on('did-finish-load', () => {
    if (!win.isVisible()) win.show()
  })
  win.webContents.on('did-fail-load', (_event, code, description) => {
    dialog.showErrorBox('AgentKeeper could not load', `${description} (${code})`)
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void confirmOpenExternal(win, url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (isTrustedRendererNavigation(url, rendererEntryUrl)) return
    event.preventDefault()
    void confirmOpenExternal(win, url)
  })

  win.webContents.on('will-redirect', (event, url) => {
    if (isTrustedRendererNavigation(url, rendererEntryUrl)) return
    event.preventDefault()
    void confirmOpenExternal(win, url)
  })

  // Plugin views live in sandboxed srcdoc frames. A frame can normally
  // navigate itself even without allow-top-navigation, which would bypass its
  // document CSP and could become a network beacon. Keep every child frame on
  // its host-provided srcdoc/about:blank document.
  win.webContents.on('will-frame-navigate', (details) => {
    if (details.isMainFrame || details.url === 'about:srcdoc' || details.url === 'about:blank') return
    details.preventDefault()
  })

  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

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
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
    if (akp) win.webContents.send('plugin:open-file', akp)
  }
})

app.on('before-quit', () => {
  pruneExpiredIfEnabled()
  stopAllWatchers()
  flushCostLedger()
  clearDevPluginRegistry()
  for (const adapter of harnessRegistry.list()) void adapter.dispose?.()
  void teardownMobileServer()
  cliServer?.close()
  cliServer = null
})

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {
        label: 'AgentKeeper',
        submenu: [
          { role: 'about' },
          {
            label: 'Check for Updates…',
            click: () => void checkForAppUpdate(),
          },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]))
    app.setAboutPanelOptions({
      applicationName: 'AgentKeeper',
      applicationVersion: app.getVersion(),
      version: '',
      credits: '',
      copyright: 'Copyright © 2024',
    })
  }
  const userData = app.getPath('userData')
  await initDb(userData, app.getVersion())
  // Legacy sessions are imported without their ambiguous provider references.
  runLegacyImport(userData)
  pruneOrphanedDrafts()
  initPricing()
  initCostLedger(userData)
  pruneLegacyBundledPlugins()
  const registry = new WorkItemRegistryImpl()
  setWorkItemRegistry(registry)
  initHarnessDefault(settingsStore.get().harnessId)
  warmAvailableModels()
  warmCapabilities()
  syncMobileServer(settingsStore.get())
  const win = createWindow()
  registerIpcHandlers(registry, win.webContents)
  wirePluginEventRelay(win)
  await activatePlugins(registry, win.webContents)
  initializeAppUpdater()
  setWebContentsOnActiveHosts(win.webContents)
  win.webContents.on('destroyed', () => {
    externalPromptWindows.delete(win.id)
    externalPromptCooldowns.delete(win.id)
    removeSubscriber(win.webContents.id)
  })
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
}).catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('[startup] Failed to initialize AgentKeeper:', error)
  dialog.showErrorBox(
    'AgentKeeper could not start',
    `The application failed during startup.\n\n${message}`,
  )
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
