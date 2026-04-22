import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import {
  IPC_CHANNELS,
  type AppSettings,
  type RecentProject,
  type SecretKeyName,
  type StartSessionParams,
} from '../shared/ipc-contract'
import { recentProjectsStore } from './store'
import { listSessions, readSession } from './sessions'
import { cancelSession, sendInput, startSession } from './agent'
import { SECRET_KEYS, secrets } from './secrets'
import { settingsStore } from './settings'

async function pickProject(): Promise<RecentProject | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const result = win
    ? await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Open Project',
      })
    : await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Open Project',
      })
  if (result.canceled || result.filePaths.length === 0) return null
  const projectPath = result.filePaths[0]!
  const project: RecentProject = {
    path: projectPath,
    name: path.basename(projectPath),
    lastOpenedAt: Date.now(),
  }
  recentProjectsStore.add(project)
  return project
}

function secretKeyToKeytarKey(k: SecretKeyName) {
  switch (k) {
    case 'anthropicApiKey':
      return SECRET_KEYS.anthropicApiKey
  }
}

export function registerIpcHandlers() {
  // Projects
  ipcMain.handle(IPC_CHANNELS.projectPick, () => pickProject())
  ipcMain.handle(IPC_CHANNELS.projectRecentList, () =>
    recentProjectsStore.list(),
  )
  ipcMain.handle(IPC_CHANNELS.projectRecentRemove, (_event, p: string) => {
    recentProjectsStore.remove(p)
  })

  // Sessions — historical
  ipcMain.handle(IPC_CHANNELS.sessionsList, (_event, projectPath: string) =>
    listSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsRead,
    (_event, projectPath: string, sessionId: string) =>
      readSession(projectPath, sessionId),
  )

  // Sessions — live
  ipcMain.handle(
    IPC_CHANNELS.sessionStart,
    (_event, params: StartSessionParams) => startSession(params),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionInput,
    (_event, sessionId: string, text: string) => {
      sendInput(sessionId, text)
    },
  )
  ipcMain.handle(IPC_CHANNELS.sessionCancel, (_event, sessionId: string) =>
    cancelSession(sessionId),
  )

  // Settings
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settingsStore.get())
  ipcMain.handle(
    IPC_CHANNELS.settingsSet,
    (_event, partial: Partial<AppSettings>) => settingsStore.set(partial),
  )

  // Secrets
  ipcMain.handle(IPC_CHANNELS.secretsHas, (_event, key: SecretKeyName) =>
    secrets.has(secretKeyToKeytarKey(key)),
  )
  ipcMain.handle(
    IPC_CHANNELS.secretsSet,
    (_event, key: SecretKeyName, value: string) =>
      secrets.set(secretKeyToKeytarKey(key), value),
  )
  ipcMain.handle(IPC_CHANNELS.secretsDelete, (_event, key: SecretKeyName) =>
    secrets.delete(secretKeyToKeytarKey(key)),
  )
}
