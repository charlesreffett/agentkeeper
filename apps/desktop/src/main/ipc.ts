import { BrowserWindow, dialog, ipcMain } from 'electron'
import path from 'node:path'
import {
  IPC_CHANNELS,
  type AppSettings,
  type RecentProject,
  type SecretKeyName,
  type StartSessionParams,
  type WorkItemStatus,
} from '../shared/ipc-contract'
import type { WorkItemRegistryFull } from './plugins'
import { recentProjectsStore } from './store'
import { listSessions, readSession } from './sessions'
import { cancelSession, sendInput, startSession } from './agent'
import { SECRET_KEYS, secrets } from './secrets'
import { settingsStore } from './settings'
import { createWorktree, listWorktrees, removeWorktree } from './worktrees'
import { deleteRole, listRoles, saveRole } from './roles'
import { deleteAgency, listAgencies, saveAgency } from './agencies'
import { startAgency } from './orchestrator'
import { executeReset } from './reset'
import { installSkill, listSkills, previewSkills, removeSkill } from './skills'
import { listCommands, removeCommand, saveCommand } from './commands'
import type {
  AgencyDraft,
  AgencyScope,
  ResetRequest,
  RoleDraft,
  RoleScope,
  Skill,
  SlashCommand,
  StartAgencyParams,
} from '../shared/ipc-contract'

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

export function registerIpcHandlers(registry: WorkItemRegistryFull) {
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

  // Agencies
  ipcMain.handle(
    IPC_CHANNELS.agenciesList,
    async (_event, projectPath: string) => {
      try {
        return await listAgencies(projectPath)
      } catch (err) {
        console.error('[ipc] agencies:list failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.agenciesSave,
    async (
      _event,
      scope: AgencyScope,
      projectPath: string,
      agency: AgencyDraft,
    ) => {
      try {
        return await saveAgency(scope, projectPath, agency)
      } catch (err) {
        console.error('[ipc] agencies:save failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.agenciesRemove,
    async (_event, scope: AgencyScope, projectPath: string, id: string) => {
      try {
        return await deleteAgency(scope, projectPath, id)
      } catch (err) {
        console.error('[ipc] agencies:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.agenciesStart,
    async (_event, params: StartAgencyParams) => {
      try {
        return await startAgency(params)
      } catch (err) {
        console.error('[ipc] agencies:start failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Skills
  ipcMain.handle(
    IPC_CHANNELS.skillsList,
    async (_event, projectPath: string) => {
      try {
        return await listSkills(projectPath)
      } catch (err) {
        console.error('[ipc] skills:list failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsInstall,
    async (
      _event,
      projectPath: string,
      source: string,
      scope: 'project' | 'global',
      skillIds?: string[],
    ) => {
      console.log('[ipc] skills:install ←', {
        projectPath,
        source,
        scope,
        skillIdsCount: skillIds?.length ?? 0,
        skillIds,
      })
      try {
        const result = await installSkill(projectPath, source, scope, skillIds)
        console.log('[ipc] skills:install ok', { source, scope })
        return result
      } catch (err) {
        console.error('[ipc] skills:install failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsPreview,
    async (_event, projectPath: string, source: string) => {
      console.log('[ipc] skills:preview ←', { projectPath, source })
      try {
        return await previewSkills(projectPath, source)
      } catch (err) {
        console.error('[ipc] skills:preview failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsRemove,
    async (_event, skill: Skill) => {
      try {
        return await removeSkill(skill)
      } catch (err) {
        console.error('[ipc] skills:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Commands
  ipcMain.handle(
    IPC_CHANNELS.commandsList,
    async (_event, projectPath: string) => {
      try {
        return await listCommands(projectPath)
      } catch (err) {
        console.error('[ipc] commands:list failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.commandsSave,
    async (
      _event,
      scope: 'project' | 'global',
      projectPath: string,
      id: string,
      body: string,
    ) => {
      try {
        return await saveCommand(scope, projectPath, id, body)
      } catch (err) {
        console.error('[ipc] commands:save failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.commandsRemove,
    async (_event, cmd: SlashCommand) => {
      try {
        return await removeCommand(cmd)
      } catch (err) {
        console.error('[ipc] commands:remove failed:', err)
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

  // Factory reset
  ipcMain.handle(
    IPC_CHANNELS.resetExecute,
    async (_event, request: ResetRequest) => {
      try {
        return await executeReset(request)
      } catch (err) {
        console.error('[ipc] reset:execute failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Work items (plugin registry)
  ipcMain.handle(IPC_CHANNELS.workItemsList, async () => {
    try {
      return await registry.list()
    } catch (err) {
      console.error('[ipc] workItems:list failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.workItemsGet, async (_event, id: string) => {
    try {
      return await registry.get(id)
    } catch (err) {
      console.error('[ipc] workItems:get failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.workItemsUpdateStatus,
    async (_event, id: string, status: WorkItemStatus) => {
      try {
        return await registry.updateStatus(id, status)
      } catch (err) {
        console.error('[ipc] workItems:updateStatus failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
}
