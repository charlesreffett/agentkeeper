import { app, BrowserWindow } from 'electron'
import electronUpdater, { type AppUpdater, type UpdateInfo } from 'electron-updater'
import { IPC_CHANNELS, type AppUpdateState } from '../shared/ipc-contract'

const { autoUpdater } = electronUpdater as unknown as { autoUpdater: AppUpdater }

let initialized = false
let state: AppUpdateState = {
  status: app.isPackaged ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
  message: app.isPackaged ? undefined : 'Updates are only available in installed builds.',
}

function normalizeReleaseNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes
      .map((note) => `${note.version}\n${note.note ?? ''}`.trim())
      .join('\n\n')
  }
  return undefined
}

function setState(patch: Partial<AppUpdateState>): void {
  state = { ...state, ...patch, currentVersion: app.getVersion() }
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC_CHANNELS.appUpdatesStateChanged, state)
  }
}

export function getAppUpdateState(): AppUpdateState {
  return { ...state }
}

export async function checkForAppUpdate(): Promise<AppUpdateState> {
  if (!app.isPackaged) return getAppUpdateState()
  if (state.status === 'checking' || state.status === 'downloading') return getAppUpdateState()
  setState({ status: 'checking', message: undefined, progressPercent: undefined })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  return getAppUpdateState()
}

export async function downloadAppUpdate(): Promise<void> {
  if (state.status !== 'available') throw new Error('No application update is available')
  setState({ status: 'downloading', progressPercent: 0, message: undefined })
  await autoUpdater.downloadUpdate()
}

export function installAppUpdate(): void {
  if (state.status !== 'downloaded') throw new Error('The application update has not finished downloading')
  autoUpdater.quitAndInstall(false, true)
}

export function initializeAppUpdater(): void {
  if (initialized || !app.isPackaged) return
  initialized = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    setState({
      status: 'available',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info),
      message: undefined,
    })
  })
  autoUpdater.on('update-not-available', () => {
    setState({ status: 'up-to-date', availableVersion: undefined, releaseNotes: undefined })
  })
  autoUpdater.on('download-progress', (progress) => {
    setState({ status: 'downloading', progressPercent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    setState({
      status: 'downloaded',
      availableVersion: info.version,
      releaseNotes: normalizeReleaseNotes(info),
      progressPercent: 100,
    })
  })
  autoUpdater.on('error', (error) => {
    setState({ status: 'error', message: error.message })
  })

  setTimeout(() => void checkForAppUpdate(), 30_000)
}
