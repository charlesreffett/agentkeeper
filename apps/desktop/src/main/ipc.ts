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
import { createWorktree, listWorktrees, removeWorktree } from './worktrees'
import { deleteRole, listRoles, saveRole } from './roles'
import type { RoleDraft, RoleScope } from '../shared/ipc-contract'

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

  // Sessions — live. Every handler normalizes its error to a plain message
  // because Electron's IPC structured-clone refuses some Error shapes
  // (causes, AggregateError, class-prototype'd exceptions from the SDK).
  ipcMain.handle(
    IPC_CHANNELS.sessionStart,
    async (_event, params: StartSessionParams) => {
      try {
        return await startSession(params)
      } catch (err) {
        console.error('[ipc] session:start failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionInput,
    async (_event, sessionId: string, text: string) => {
      try {
        sendInput(sessionId, text)
      } catch (err) {
        console.error('[ipc] session:input failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionCancel,
    async (_event, sessionId: string) => {
      try {
        await cancelSession(sessionId)
      } catch (err) {
        console.error('[ipc] session:cancel failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Settings
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settingsStore.get())
  ipcMain.handle(
    IPC_CHANNELS.settingsSet,
    (_event, partial: Partial<AppSettings>) => settingsStore.set(partial),
  )

  // Worktrees
  ipcMain.handle(
    IPC_CHANNELS.worktreesList,
    async (_event, projectPath: string) => {
      try {
        return await listWorktrees(projectPath)
      } catch (err) {
        console.error('[ipc] worktrees:list failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.worktreesCreate,
    async (_event, projectPath: string, branchRequest: string) => {
      try {
        return await createWorktree(projectPath, { branchRequest })
      } catch (err) {
        console.error('[ipc] worktrees:create failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.worktreesRemove,
    async (_event, projectPath: string, worktreePath: string) => {
      try {
        return await removeWorktree(projectPath, worktreePath)
      } catch (err) {
        console.error('[ipc] worktrees:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Roles
  ipcMain.handle(IPC_CHANNELS.rolesList, async (_event, projectPath: string) => {
    try {
      return await listRoles(projectPath)
    } catch (err) {
      console.error('[ipc] roles:list failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.rolesSave,
    async (
      _event,
      scope: RoleScope,
      projectPath: string,
      role: RoleDraft,
    ) => {
      try {
        return await saveRole(scope, projectPath, role)
      } catch (err) {
        console.error('[ipc] roles:save failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.rolesRemove,
    async (_event, scope: RoleScope, projectPath: string, id: string) => {
      try {
        return await deleteRole(scope, projectPath, id)
      } catch (err) {
        console.error('[ipc] roles:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
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
