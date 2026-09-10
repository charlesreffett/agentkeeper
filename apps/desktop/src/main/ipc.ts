import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron'
import type { EventMap } from '@agentkeeper/sdk'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { watch as fsWatch } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  IPC_CHANNELS,
  isGeneralProject,
  type AddAgentParams,
  type AppSettings,
  type Attachment,
  type CreateProjectParams,
  type DayTotal,
  type ProjectDayTotal,
  type HarnessInfo,
  type HarnessAuthInfo,
  type HarnessConfigurationState,
  type PluginSource,
  type RecentProject,
  type StartSessionParams,
  type WorkItemCreateParams,
  type WorkItemStatus,
} from '../shared/ipc-contract'
import * as costLedger from './cost-ledger'
import { getDraft, setDraft, clearDraft } from './drafts'
import { getAllStats, upsertStats, markStatsImported, isStatsImported, flushInProgressTokens } from './stats'
import { getDb, runMigrations } from './db/index'
import { sql } from 'drizzle-orm'
import type { SessionStatRow } from '../shared/ipc-contract'
import { getAllPricing, refreshFromLiteLLM } from './pricing'
import { getAvailableModels, refreshAvailableModels, getDefaultModel, invalidateAvailableModels, validateCustomModel } from './models'
import { getCapabilities } from './capabilities'
import type { WorkItemRegistryFull } from './plugins'
import { getPluginConfig, getPluginEventBus, setPluginConfig } from './plugins'
import {
  cancelAkpInstall,
  checkForUpdates,
  confirmAkpInstall,
  disablePlugin,
  enablePlugin,
  approvePluginPermissions,
  listPlugins,
  isPendingDevInstall,
  prepareAkpInstall,
  prepareDevPluginInstall,
  stopAllDevPlugins,
  uninstallPlugin,
  unloadDevPlugin,
  updatePlugin,
  getPluginRendererBundle,
} from './plugin-manager.js'
import { getActiveHost } from './plugin-loader.js'
import { getRawSqlite } from './db/index'
import { detectProjectRemotes, recentProjectsStore } from './store'
import { commit, createBranch, detectRemoteSources, getBranch, getStatus, isGitRepo, listBranches, pull, push, stageFiles, switchBranch, switchBranchCreate, unstageFiles } from './git'
import { liveSessionBlocksBranchSwitch } from './session-branch-policy'
import { suggestCommits } from './git-ai'
import { listSessions, readSession, deleteHistoricalSession, deleteAllHistoricalSessions } from './sessions'
import { interruptSession, terminateSession, resumeSession, sendInput, startSession, setModel, setEffort, setPermissionMode, isSessionActive, reconnectSessionMcp, setDefaultMcpFactoryResolver, editAndRerun, undoEditAndRerun } from './agent'
import { harnessSecrets } from './secrets'
import { settingsStore } from './settings'
import { createWorktree, gitDiffStat, listWorktrees, removeWorktree } from './worktrees'
import { deleteRole, generateRoleContent, listRoles, saveRole } from './roles'
import { deleteAgency, listAgencies, saveAgency } from './agencies'
import { generateAndPersistSessionTitle, isAgencyRuntimeActive, resumeAgency, startAgency, createProjectMcp, createOrchestratorMcp } from './orchestrator'
import * as sessionRegistry from './session-registry'
import { executeReset } from './reset'
import { adoptSkill, generateSkillContent, installSkill, listSkills, previewSkills, removeSkill, saveSkill } from './skills'
import { listCommands, removeCommand, saveCommand, generateCommandContent } from './commands'
import { listPlans, getPlan, createPlan, updatePlan, deletePlan, removeSessionFromPlans, removeAllSessionsFromPlans } from './plans'
import { getPerformanceSummary } from './performance'
import { harnessRegistry, getHarness } from './harness/index'
import { syncMobileServer } from './mobile-server'
import { startWatching, stopWatching } from './watcher.js'
import { registerTerminalHandlers } from './terminal'
import { checkForAppUpdate, downloadAppUpdate, getAppUpdateState, installAppUpdate } from './app-updater'
import type {
  AgencyDraft,
  AgencyScope,
  FsEntry,
  PermissionMode,
  PlansCreateInput,
  PlansUpdateInput,
  ResetRequest,
  RoleEffort,
  RoleDraft,
  RoleScope,
  Skill,
  SlashCommand,
  StartAgencyParams,
  SwitchBranchOptions,
  SwitchResult,
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
    remotes: await detectProjectRemotes(projectPath),
    lastOpenedAt: Date.now(),
  }
  recentProjectsStore.add(project)
  return project
}

export function registerIpcHandlers(registry: WorkItemRegistryFull, mainWebContents: Electron.WebContents) {
  const assertTrustedMainRenderer = (event: Electron.IpcMainInvokeEvent): void => {
    if (event.sender !== mainWebContents || event.senderFrame !== mainWebContents.mainFrame) {
      throw new Error('Unauthorized plugin IPC sender')
    }
  }
  ipcMain.handle(IPC_CHANNELS.appUpdatesGetState, () => getAppUpdateState())
  ipcMain.handle(IPC_CHANNELS.appUpdatesCheck, () => checkForAppUpdate())
  ipcMain.handle(IPC_CHANNELS.appUpdatesDownload, () => downloadAppUpdate())
  ipcMain.handle(IPC_CHANNELS.appUpdatesInstall, () => installAppUpdate())

  // Every session — including ones revived via resume/auto-resume paths that
  // don't pass an mcpFactory — gets the agentkeeper MCP server. General chats
  // skip it entirely: no project means no plan store, so the agent stays a
  // clean Claude Code.
  setDefaultMcpFactoryResolver(({ projectPath, agentLocalId, isAgency }) => {
    if (isGeneralProject(projectPath)) return undefined
    return isAgency
      ? () => createOrchestratorMcp(projectPath, agentLocalId)
      : () => createProjectMcp(projectPath)
  })

  // Projects (registry)
  ipcMain.handle(IPC_CHANNELS.projectsAdd, async (_event, projectPath: string) => {
    try {
      const remotes = await detectProjectRemotes(projectPath)
      const existing = recentProjectsStore.list().find((p) => p.path === projectPath)
      const project: RecentProject = {
        path: projectPath,
        name: path.basename(projectPath),
        remotes: existing?.remotes.length ? existing.remotes : remotes,
        lastOpenedAt: Date.now(),
      }
      recentProjectsStore.add(project)
      return project
    } catch (err) {
      console.error('[ipc] projects:add failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.projectsRemove, (_event, projectPath: string) => {
    recentProjectsStore.remove(projectPath)
  })
  ipcMain.handle(IPC_CHANNELS.projectsList, () => recentProjectsStore.list())
  ipcMain.handle(IPC_CHANNELS.projectsReorder, (_event, paths: string[]) => {
    recentProjectsStore.reorder(paths)
  })
  ipcMain.handle(IPC_CHANNELS.projectsGetFocused, () => {
    const focusedPath = recentProjectsStore.getFocused()
    if (!focusedPath) return null
    return recentProjectsStore.list().find((p) => p.path === focusedPath) ?? null
  })
  ipcMain.handle(IPC_CHANNELS.projectsSetFocused, (_event, projectPath: string | null) => {
    recentProjectsStore.setFocused(projectPath)
  })
  ipcMain.handle(IPC_CHANNELS.projectsGetPinnedBranches, (_event, projectPath: string) => {
    return recentProjectsStore.getPinnedBranches(projectPath)
  })
  ipcMain.handle(IPC_CHANNELS.projectsSetPinnedBranches, (_event, projectPath: string, branches: string[]) => {
    recentProjectsStore.setPinnedBranches(projectPath, branches)
  })
  ipcMain.handle(IPC_CHANNELS.projectsRename, (_event, oldPath: string, newName: string, renameDir: boolean) => {
    try {
      return recentProjectsStore.rename(oldPath, newName, renameDir)
    } catch (err) {
      console.error('[ipc] projects:rename failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.projectsUpdate, async (_event, oldPath: string, name: string, sourcePath: string) => {
    try {
      const trimmedName = name.trim()
      if (!trimmedName) throw new Error('Project name is required')
      const stats = await fs.stat(sourcePath)
      if (!stats.isDirectory()) throw new Error('Source folder must be a directory')
      const remotes = await detectProjectRemotes(sourcePath)
      return recentProjectsStore.update(oldPath, {
        path: sourcePath,
        name: trimmedName,
        remotes,
        lastOpenedAt: Date.now(),
      })
    } catch (err) {
      console.error('[ipc] projects:update failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.projectsReveal, (_event, projectPath: string) => {
    shell.showItemInFolder(projectPath)
  })
  ipcMain.handle(IPC_CHANNELS.projectsPickFolder, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
  })

  ipcMain.handle(IPC_CHANNELS.projectsCreate, async (_event, params: CreateProjectParams) => {
    const projectPath = path.join(params.parentDir, params.dirName)
    try {
      await fs.access(projectPath)
      throw new Error(`Directory already exists: ${projectPath}`)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    await fs.mkdir(projectPath, { recursive: true })
    await fs.mkdir(path.join(projectPath, '.agentkeeper'), { recursive: true })
    const remotes = await detectProjectRemotes(projectPath)
    const project: RecentProject = {
      path: projectPath,
      name: params.name,
      remotes,
      lastOpenedAt: Date.now(),
    }
    recentProjectsStore.add(project)
    return project
  })

  ipcMain.handle(IPC_CHANNELS.dialogOpenFiles, async (): Promise<Attachment[]> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] })
      : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    if (result.canceled || result.filePaths.length === 0) return []
    return Promise.all(
      result.filePaths.map(async (filePath) => {
        const name = path.basename(filePath)
        const buf = await fs.readFile(filePath)
        // Detect MIME from extension — good enough for images and common text files
        const ext = path.extname(filePath).toLowerCase()
        const imageExts: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        }
        const mimeType = imageExts[ext] ?? 'text/plain'
        const content = mimeType.startsWith('image/')
          ? buf.toString('base64')
          : buf.toString('utf-8')
        return { name, mimeType, content } satisfies Attachment
      }),
    )
  })

  // Projects (legacy — kept for existing UI)
  ipcMain.handle(IPC_CHANNELS.projectPick, () => pickProject())
  ipcMain.handle(IPC_CHANNELS.projectRecentList, () =>
    recentProjectsStore.list(),
  )
  ipcMain.handle(IPC_CHANNELS.projectRecentRemove, (_event, p: string) => {
    recentProjectsStore.remove(p)
  })

  // Sessions — historical
  ipcMain.handle(IPC_CHANNELS.sessionsList, (_event, projectPath: string | null) =>
    listSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsRead,
    (_event, projectPath: string | null, sessionId: string, harnessId?: string) => readSession(projectPath, sessionId, harnessId),
  )

  ipcMain.handle(
    IPC_CHANNELS.pluginsGetRendererBundle,
    (event, pluginId: string, viewId: string) => { assertTrustedMainRenderer(event); return getPluginRendererBundle(pluginId, viewId) },
  )

  // Sessions — live. Every handler normalizes its error to a plain message
  // because Electron's IPC structured-clone refuses some Error shapes
  // (causes, AggregateError, class-prototype'd exceptions from the SDK).
  ipcMain.handle(
    IPC_CHANNELS.sessionStart,
    async (_event, params: StartSessionParams) => {
      try {
        // Resolve any user-selected external MCP servers into plain configs
        // the SDK can consume directly (stdio/http/sse — no SDK objects needed).
        const additionalMcpServers: Record<string, import('./agent').ExternalMcpConfig> = {}
        if (params.mcpServerIds && params.mcpServerIds.length > 0) {
          const allEntries = settingsStore.get().mcpServers ?? []
          for (const id of params.mcpServerIds) {
            const entry = allEntries.find((e) => e.id === id)
            if (!entry) continue
            if (entry.type === 'stdio' && entry.command) {
              additionalMcpServers[entry.name] = {
                type: 'stdio' as const,
                command: entry.command,
                ...(entry.args ? { args: entry.args } : {}),
                ...(entry.env ? { env: entry.env } : {}),
              }
            } else if ((entry.type === 'http' || entry.type === 'sse') && entry.url) {
              additionalMcpServers[entry.name] = {
                type: entry.type,
                url: entry.url,
                ...(entry.headers ? { headers: entry.headers } : {}),
              }
            }
          }
        }

        const agentLocalId = await startSession(params, {
          ...(!isGeneralProject(params.projectPath)
            ? { mcpFactory: () => createProjectMcp(params.projectPath) }
            : {}),
          ...(Object.keys(additionalMcpServers).length > 0 ? { additionalMcpServers } : {}),
        })
        if (params.initialPrompt) {
          // Title is stored on the session row; for solo sessions agentLocalId = sessionLocalId.
          const sessionId = params.sessionLocalId ?? agentLocalId
          void generateAndPersistSessionTitle(sessionId, params.initialPrompt)
        }
        return agentLocalId
      } catch (err) {
        console.error('[ipc] session:start failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionInput,
    async (_event, sessionId: string, text: string, attachments?: Attachment[]) => {
      try {
        // Resolve to an agentLocalId and ensure the agency runtime is active.
        // sessionId may be a session UUID (new renderer: agency instanceId or solo UUID)
        // or an agent UUID (old renderer / direct agent targeting).
        let agentLocalIdToSend = sessionId
        let agencySessionId: string | null = null

        const session = sessionRegistry.getSession(sessionId)
        if (session?.agencyId) {
          // sessionId is the agency session UUID — find the entry-point agent
          agencySessionId = sessionId
          const agents = sessionRegistry.listAgentsBySession(sessionId)
          const entryAgent = agents.find(a => a.isEntryPoint) ?? agents[0]
          if (entryAgent) agentLocalIdToSend = entryAgent.localId
        } else {
          // sessionId may be an agentLocalId belonging to an agency
          const agent = sessionRegistry.getAgent(sessionId)
          if (agent && agent.sessionLocalId !== sessionId) {
            const parentSession = sessionRegistry.getSession(agent.sessionLocalId)
            if (parentSession?.agencyId) agencySessionId = agent.sessionLocalId
          }
        }

        if (agencySessionId && !isAgencyRuntimeActive(agencySessionId)) {
          await resumeAgency(agencySessionId)
        }
        await sendInput(agentLocalIdToSend, text, attachments)
        sessionRegistry.touchSessionUserMessage(agencySessionId ?? sessionId)
      } catch (err) {
        console.error('[ipc] session:input failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionInterrupt,
    async (_event, sessionId: string) => {
      try {
        return await interruptSession(sessionId)
      } catch (err) {
        console.error('[ipc] session:interrupt failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionTerminate,
    async (_event, sessionId: string) => {
      try {
        await terminateSession(sessionId)
      } catch (err) {
        console.error('[ipc] session:terminate failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Settings
  ipcMain.handle(IPC_CHANNELS.settingsGet, () => settingsStore.get())
  ipcMain.handle(
    IPC_CHANNELS.settingsSet,
    (event, partial: Partial<AppSettings>) => {
      assertTrustedMainRenderer(event)
      // Developer mode has a separate native-confirmed authority path.
      const { pluginDeveloperMode: _ignored, ...safePartial } = partial
      const updated = settingsStore.set(safePartial)
      syncMobileServer(updated)
      if (safePartial.harnessBins || safePartial.customModels) {
        for (const id of new Set([
          ...Object.keys(safePartial.harnessBins ?? {}),
          ...Object.keys(safePartial.customModels ?? {}),
        ])) {
          invalidateAvailableModels(id)
          void refreshAvailableModels(id)
        }
      }
      return updated
    },
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
    async (_event, projectPath: string, options: { baseRef?: string; branchRequest: string }) => {
      try {
        return await createWorktree(projectPath, options)
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
  ipcMain.handle(
    IPC_CHANNELS.worktreesGitDiffStat,
    async (_event, worktreePath: string, baseBranch?: string) => {
      try {
        return await gitDiffStat(worktreePath, baseBranch)
      } catch (err) {
        console.error('[ipc] worktrees:gitDiffStat failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Roles
  ipcMain.handle(IPC_CHANNELS.rolesList, async (_event, projectPath: string | null) => {
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
      projectPath: string | null,
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
    async (_event, scope: RoleScope, projectPath: string | null, id: string) => {
      try {
        return await deleteRole(scope, projectPath, id)
      } catch (err) {
        console.error('[ipc] roles:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.rolesGenerate,
    async (_event, prompt: string) => {
      try {
        return await generateRoleContent(prompt)
      } catch (err) {
        console.error('[ipc] roles:generate failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Agencies
  ipcMain.handle(
    IPC_CHANNELS.agenciesList,
    async (_event, projectPath: string | null) => {
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
      projectPath: string | null,
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
    async (_event, scope: AgencyScope, projectPath: string | null, id: string) => {
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
      try {
        return await installSkill(projectPath, source, scope, skillIds)
      } catch (err) {
        console.error('[ipc] skills:install failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsPreview,
    async (_event, projectPath: string, source: string) => {
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
    async (_event, projectPath: string, skill: Skill) => {
      try {
        return await removeSkill(projectPath, skill)
      } catch (err) {
        console.error('[ipc] skills:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsAdopt,
    async (_event, projectPath: string, skill: Skill) => {
      try {
        return await adoptSkill(projectPath, skill, app.getPath('userData'))
      } catch (err) {
        console.error('[ipc] skills:adopt failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsGenerate,
    async (_event, prompt: string) => {
      try {
        return await generateSkillContent(prompt)
      } catch (err) {
        console.error('[ipc] skills:generate failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.skillsSave,
    async (_event, projectPath: string, id: string, scope: 'project' | 'global', content: string) => {
      try {
        return await saveSkill(projectPath, id, scope, content)
      } catch (err) {
        console.error('[ipc] skills:save failed:', err)
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
    IPC_CHANNELS.commandsGenerate,
    async (_event, prompt: string) => {
      try {
        return await generateCommandContent(prompt)
      } catch (err) {
        console.error('[ipc] commands:generate failed:', err)
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
        const result = await saveCommand(scope, projectPath, id, body)
        broadcastCommandsChanged()
        return result
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
        await removeCommand(cmd)
        broadcastCommandsChanged()
      } catch (err) {
        console.error('[ipc] commands:remove failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
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

  // Plugin config
  ipcMain.handle(IPC_CHANNELS.pluginsConfigGet, (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    return getPluginConfig(pluginId, getRawSqlite())
  },
  )
  ipcMain.handle(
    IPC_CHANNELS.pluginsConfigSet,
    async (event, pluginId: string, config: unknown) => {
      assertTrustedMainRenderer(event)
      try {
        return await setPluginConfig(pluginId, config, getRawSqlite())
      } catch (err) {
        console.error('[ipc] plugins:config:set failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Plugin management
  ipcMain.handle(IPC_CHANNELS.pluginsList, (event) => {
    assertTrustedMainRenderer(event)
    const rows = listPlugins()
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      enabled: row.enabled === 1,
      source: row.source as PluginSource,
      status: getActiveHost(row.id) ? 'active' : (row.enabled === 1 && row.source === 'bundled' ? 'active' : 'inactive'),
      manifest: JSON.parse(row.manifest),
      actionRequired: row.action_required === 1,
      grantedAuthority: JSON.parse(row.granted_authority),
      ...(row.dev_path ? { devPath: row.dev_path } : {}),
    }))
  })

  ipcMain.handle(IPC_CHANNELS.pluginsPickAkpFile, async (event): Promise<string | null> => {
    assertTrustedMainRenderer(event)
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, {
          filters: [{ name: 'AgentKeeper Plugin', extensions: ['akp'] }],
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          filters: [{ name: 'AgentKeeper Plugin', extensions: ['akp'] }],
          properties: ['openFile'],
        })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC_CHANNELS.pluginsPrepareAkpInstall, async (event, opts: { filePath?: string; manifestUrl?: string }) => {
    assertTrustedMainRenderer(event)
    try {
      return await prepareAkpInstall(opts)
    } catch (err) {
      console.error('[ipc] plugins:prepareAkpInstall failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsConfirmAkpInstall, async (event, token: string) => {
    assertTrustedMainRenderer(event)
    try {
      const isDev = isPendingDevInstall(token)
      if (isDev && !settingsStore.get().pluginDeveloperMode) throw new Error('Plugin developer mode is disabled')
      const confirmation = await dialog.showMessageBox(BrowserWindow.fromWebContents(mainWebContents)!, {
        type: 'warning', buttons: ['Cancel', 'Install'], defaultId: 0, cancelId: 0,
        title: isDev ? 'Load mutable unpacked plugin?' : 'Install untrusted plugin?',
        message: isDev
          ? 'Unpacked plugin files are unsigned development inputs and may change after you review them.'
          : 'Plugins are unsigned. Confirm the exact package shown in AgentKeeper before installing.',
        detail: 'The plugin still runs within the normal sandbox, permission grants, quotas, and broker enforcement. The nativeProcess permission is a sandbox escape.',
      })
      if (confirmation.response !== 1) throw new Error('Plugin installation cancelled')
      await confirmAkpInstall(token)
    } catch (err) {
      console.error('[ipc] plugins:confirmAkpInstall failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsDeveloperModeGet, (event) => {
    assertTrustedMainRenderer(event)
    return settingsStore.get().pluginDeveloperMode
  })

  ipcMain.handle(IPC_CHANNELS.pluginsDeveloperModeSet, async (event, enabled: boolean) => {
    assertTrustedMainRenderer(event)
    if (typeof enabled !== 'boolean') throw new Error('Developer mode must be a boolean')
    if (enabled) {
      const confirmation = await dialog.showMessageBox(BrowserWindow.fromWebContents(mainWebContents)!, {
        type: 'warning', buttons: ['Cancel', 'Enable developer mode'], defaultId: 0, cancelId: 0,
        title: 'Enable plugin developer mode?',
        message: 'Unpacked plugin files are mutable, unsigned development inputs.',
        detail: 'Files may change after review. Each initial load and authority change still requires permission review and native confirmation.',
      })
      if (confirmation.response !== 1) return false
      settingsStore.setPluginDeveloperMode(true)
      return true
    }
    settingsStore.setPluginDeveloperMode(false)
    await stopAllDevPlugins()
    return false
  })

  ipcMain.handle(IPC_CHANNELS.pluginsCancelAkpInstall, (event, token: string) => {
    assertTrustedMainRenderer(event)
    cancelAkpInstall(token)
  })

  ipcMain.handle(IPC_CHANNELS.pluginsLoadDev, async (event, dirPath?: string) => {
    assertTrustedMainRenderer(event)
    if (!settingsStore.get().pluginDeveloperMode) throw new Error('Enable plugin developer mode in Settings before loading unpacked plugins')
    try {
      let resolvedPath = dirPath
      if (!resolvedPath) {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
        const result = win
          ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] })
        if (result.canceled || !result.filePaths[0]) return
        resolvedPath = result.filePaths[0]
      }
      return await prepareDevPluginInstall(resolvedPath)
    } catch (err) {
      console.error('[ipc] plugins:loadDev failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsUnloadDev, async (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    try {
      await unloadDevPlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:unloadDev failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsUninstall, async (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    try {
      await uninstallPlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:uninstall failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsEnable, async (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    try {
      await enablePlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:enable failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsApprovePermissions, async (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    try {
      await approvePluginPermissions(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:approvePermissions failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsDisable, async (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    try {
      await disablePlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:disable failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsCheckUpdates, async (event) => {
    assertTrustedMainRenderer(event)
    try {
      const updates = await checkForUpdates()
      return updates.map(({ pluginId, currentVersion, availableVersion, releaseNotes }) => ({
        pluginId,
        currentVersion,
        availableVersion,
        releaseNotes,
      }))
    } catch (err) {
      console.error('[ipc] plugins:checkUpdates failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsUpdate, async (event, pluginId: string) => {
    assertTrustedMainRenderer(event)
    try {
      const updates = await checkForUpdates()
      const entry = updates.find((u) => u.pluginId === pluginId)
      if (!entry) throw new Error(`No update available for plugin ${pluginId}`)
      return await updatePlugin(pluginId, entry.release)
    } catch (err) {
      console.error('[ipc] plugins:update failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.pluginsInvoke,
    async (event, pluginId: string, commandId: string, args?: unknown) => {
      assertTrustedMainRenderer(event)
      const host = getActiveHost(pluginId)
      if (!host) throw new Error('Provider not available')
      return host.invokeCommand(commandId, args)
    },
  )

  // Remote sources
  ipcMain.handle(IPC_CHANNELS.remotesDetect, (_event, projectPath: string) =>
    detectRemoteSources(projectPath),
  )

  // Session registry — persisted sessions + resume + delete + touch
  // Reset any sessions left mid-flight by a previous process, then prune old ones.
  sessionRegistry.resetStaleRunning()
  flushInProgressTokens()
  sessionRegistry.pruneExpiredIfEnabled()

  ipcMain.handle(
    IPC_CHANNELS.sessionsListPersisted,
    (_event, projectPath: string | null) => sessionRegistry.listSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsGetByLocalId,
    (_event, localId: string) => sessionRegistry.getSession(localId) ?? null,
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsResume,
    async (_event, localId: string) => {
      try {
        // localId can be a session UUID (agency instanceId or solo) or an agent UUID.
        const session = sessionRegistry.getSession(localId)
        if (session?.agencyId) {
          // localId is the agency session UUID
          if (!isAgencyRuntimeActive(localId)) {
            await resumeAgency(localId)
          }
          return localId
        }

        // Check if localId is an agentLocalId belonging to an agency
        const agent = sessionRegistry.getAgent(localId)
        if (agent && agent.sessionLocalId !== localId) {
          const parentSession = sessionRegistry.getSession(agent.sessionLocalId)
          if (parentSession?.agencyId) {
            if (!isAgencyRuntimeActive(agent.sessionLocalId)) {
              await resumeAgency(agent.sessionLocalId)
            }
            if (isSessionActive(localId)) return localId
            // Fall through to resumeSession if this agent wasn't re-activated
          }
        }

        return await resumeSession(localId)
      } catch (err) {
        console.error('[ipc] sessions:resume failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeletePersisted,
    async (_event, localId: string) => {
      const session = sessionRegistry.getSession(localId)
      if (session) {
        await removeSessionFromPlans(session.projectPath, localId).catch(() => {})
      }
      sessionRegistry.deleteSession(localId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsTouchPersisted,
    (_event, localId: string) => {
      sessionRegistry.touchSession(localId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsSetModel,
    (_event, localId: string, model: string) => setModel(localId, model),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsSetEffort,
    async (_event, localId: string, effort: RoleEffort) => {
      try {
        return await setEffort(localId, effort)
      } catch (err) {
        console.error('[ipc] sessions:setEffort failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsSetPermissionMode,
    async (_event, localId: string, mode: PermissionMode) => {
      try {
        return await setPermissionMode(localId, mode)
      } catch (err) {
        console.error('[ipc] sessions:setPermissionMode failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeleteHistorical,
    (_event, projectPath: string | null, sessionId: string) =>
      deleteHistoricalSession(projectPath, sessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeleteAllHistorical,
    (_event, projectPath: string | null) => deleteAllHistoricalSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeleteAllPersisted,
    async (_event, projectPath: string | null) => {
      await removeAllSessionsFromPlans(projectPath).catch(() => {})
      sessionRegistry.deleteAllForProject(projectPath)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsGetAgents,
    (_event, sessionLocalId: string) => sessionRegistry.listAgentsBySession(sessionLocalId),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsListTrackedSdkIds,
    (_event, projectPath: string | null) => sessionRegistry.listTrackedSdkIds(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsAddAgent,
    async (_event, sessionLocalId: string, params: AddAgentParams) => {
      try {
        const session = sessionRegistry.getSession(sessionLocalId)
        if (!session) throw new Error(`Session ${sessionLocalId} not found`)
        const agentLocalId = randomUUID()
        return await startSession(
          {
            localId: agentLocalId,
            agentLocalId,
            sessionLocalId,
            projectPath: session.projectPath,
            worktreePath: session.worktreePath ?? undefined,
            ...params,
          },
          // General chats carry no agentkeeper MCP server.
          isGeneralProject(session.projectPath)
            ? {}
            : { mcpFactory: () => createProjectMcp(session.projectPath) },
        )
      } catch (err) {
        console.error('[ipc] sessions:addAgent failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsReconnectMcp,
    async (_event, agentLocalId: string) => {
      try {
        const agent = sessionRegistry.getAgent(agentLocalId)
        if (!agent?.sdkSessionId) throw new Error(`No SDK session ID for agent ${agentLocalId}`)
        const persistedSession = sessionRegistry.getSession(agent.sessionLocalId)
        if (!persistedSession) throw new Error(`No persisted session for agent ${agentLocalId}`)
        const factory = persistedSession.agencyId
          ? () => createOrchestratorMcp(persistedSession.projectPath, agentLocalId)
          : () => createProjectMcp(persistedSession.projectPath)
        return await reconnectSessionMcp(agentLocalId, factory)
      } catch (err) {
        console.error('[ipc] sessions:reconnectMcp failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsEditAndRerun,
    async (_event, agentLocalId: string, truncateFromUuid: string, newText: string, originalText?: string | null, attachments?: Attachment[]) => {
      try {
        await editAndRerun(agentLocalId, truncateFromUuid, newText, originalText, attachments)
      } catch (err) {
        console.error('[ipc] sessions:editAndRerun failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsUndoEditAndRerun,
    async (_event, agentLocalId: string) => {
      try {
        await undoEditAndRerun(agentLocalId)
      } catch (err) {
        console.error('[ipc] sessions:undoEditAndRerun failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.agenciesResume,
    async (_event, instanceId: string) => {
      try {
        return await resumeAgency(instanceId)
      } catch (err) {
        console.error('[ipc] agencies:resume failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.agenciesSetFallbackModel,
    async (_event, instanceId: string, model: string) => {
      const session = sessionRegistry.getSession(instanceId)
      if (!session) return { ok: false, reason: 'session-not-found', message: `Session ${instanceId} was not found.` }
      if (!session.agencyName) return { ok: false, reason: 'agency-owned', message: 'This is not an agency session.' }
      const status = sessionRegistry.computeSessionStatus(sessionRegistry.listAgentsBySession(instanceId))
      if (status === 'running') return { ok: false, reason: 'session-running', message: 'Wait for the agency turn to finish before changing its fallback model.' }
      if (status === 'completed' || status === 'inactive' || status === 'error') {
        return { ok: false, reason: 'session-terminal', message: `Cannot change the model on a ${status} agency.` }
      }
      const harnessId = session.harnessId
      if ((await getCapabilities(harnessId)).modelSelection === 'draft-only') {
        return { ok: false, reason: 'model-selection-unsupported', message: 'This harness fixes the model when the agency starts.' }
      }
      const validated = await validateCustomModel(harnessId, model)
      if (!validated) return { ok: false, reason: 'model-invalid', message: 'The selected model is not available for this harness.' }
      sessionRegistry.updateSession(instanceId, { model: validated })
      return { ok: true }
    },
  )
  // Git utilities
  ipcMain.handle(IPC_CHANNELS.gitGetBranch, (_event, projectPath: string) => {
    return getBranch(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.gitGetStatus, (_event, projectPath: string) => {
    return getStatus(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.gitStageFiles, (_event, projectPath: string, files: string[]) => {
    return stageFiles(projectPath, files)
  })

  ipcMain.handle(IPC_CHANNELS.gitUnstageFiles, (_event, projectPath: string, files: string[]) => {
    return unstageFiles(projectPath, files)
  })

  ipcMain.handle(IPC_CHANNELS.gitCommit, (_event, projectPath: string, message: string) => {
    return commit(projectPath, message)
  })

  ipcMain.handle(IPC_CHANNELS.gitPush, (_event, projectPath: string) => {
    return push(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.gitPull, (_event, projectPath: string) => {
    return pull(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.gitCreateBranch, (_event, projectPath: string, branchName: string) => {
    return createBranch(projectPath, branchName)
  })

  ipcMain.handle(IPC_CHANNELS.gitListBranches, async (_event, projectPath: string) => {
    try {
      return await listBranches(projectPath)
    } catch (err) {
      console.error('[ipc] git:listBranches failed:', err)
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.gitIsRepo, (_event, projectPath: string) => {
    return isGitRepo(projectPath)
  })

  // Enforced here (not only in the renderer) — the mobile companion and future
  // callers hit the same channel. Changing HEAD under a running agent corrupts
  // its pinned-branch assumptions, but re-selecting the current branch is a
  // no-op and must allow multiple sessions to share that checkout. Path
  // comparison, not project identity: linked worktrees have independent HEADs.
  function hasLiveSessionAt(projectPath: string): boolean {
    const LIVE = new Set(['running', 'starting', 'blocked'])
    return sessionRegistry
      .listAllSessions()
      .some((s) => (s.worktreePath ?? s.projectPath) === projectPath && LIVE.has(s.status ?? ''))
  }

  ipcMain.handle(
    IPC_CHANNELS.gitSwitchBranch,
    async (_event, projectPath: string, name: string, opts?: SwitchBranchOptions): Promise<SwitchResult> => {
      const blocked = liveSessionBlocksBranchSwitch(
        hasLiveSessionAt(projectPath),
        await getBranch(projectPath),
        name,
      )
      if (blocked) return { ok: false, blocked: 'live-session' }
      return switchBranch(projectPath, name, opts)
    },
  )

  ipcMain.handle(
    IPC_CHANNELS.gitSwitchBranchCreate,
    (_event, projectPath: string, name: string, from?: string): Promise<SwitchResult> | SwitchResult => {
      if (hasLiveSessionAt(projectPath)) return { ok: false, blocked: 'live-session' }
      return switchBranchCreate(projectPath, name, from)
    },
  )

  ipcMain.handle(IPC_CHANNELS.gitSuggestCommits, (_event, projectPath: string) => {
    return suggestCommits(projectPath)
  })

  ipcMain.handle(IPC_CHANNELS.fsListDirectory, async (_event, dirPath: string) => {
    const EXCLUDED = new Set(['.git', 'node_modules', '.DS_Store', 'dist', '.next', 'build'])
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const result: FsEntry[] = entries
        .filter((e) => !EXCLUDED.has(e.name))
        .map((e) => ({
          name: e.name,
          path: `${dirPath}/${e.name}`,
          isDirectory: e.isDirectory(),
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      return result
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.fsWatchStart, (event, projectPath: string) => {
    startWatching(projectPath, event.sender.id)
  })

  ipcMain.handle(IPC_CHANNELS.fsWatchStop, (event, projectPath: string) => {
    stopWatching(projectPath, event.sender.id)
  })

  // Plans
  ipcMain.handle(IPC_CHANNELS.plansList, (_e, projectPath: string) => listPlans(projectPath))
  ipcMain.handle(IPC_CHANNELS.plansGet, (_e, projectPath: string, id: string) => getPlan(projectPath, id))
  ipcMain.handle(
    IPC_CHANNELS.plansCreate,
    (_e, projectPath: string, data: PlansCreateInput) => createPlan(projectPath, data),
  )
  ipcMain.handle(
    IPC_CHANNELS.plansUpdate,
    (_e, projectPath: string, id: string, patch: PlansUpdateInput) =>
      updatePlan(projectPath, id, patch),
  )
  ipcMain.handle(IPC_CHANNELS.plansDelete, (_e, projectPath: string, id: string) =>
    deletePlan(projectPath, id),
  )

  // Cost ledger + pricing
  ipcMain.handle(IPC_CHANNELS.costsGetDailySummary, (): DayTotal[] =>
    costLedger.getDailySummary(),
  )
  ipcMain.handle(IPC_CHANNELS.costsGetDailySummaryByProject, (): ProjectDayTotal[] =>
    costLedger.getDailySummaryByProject(),
  )
  ipcMain.handle(
    IPC_CHANNELS.costsAddLegacy,
    (_e, entries: Array<{ date: string; tokens: number; costUsd: number }>) => {
      for (const e of entries) costLedger.addLegacyEntry(e.date, e.tokens, e.costUsd)
    },
  )

  ipcMain.handle(IPC_CHANNELS.pricingGetTable, () => getAllPricing())

  ipcMain.handle(IPC_CHANNELS.pricingRefresh, async () => {
    await refreshFromLiteLLM()
    return getAllPricing()
  })

  ipcMain.handle(IPC_CHANNELS.modelsList, (_e, harnessId?: string) => getAvailableModels(harnessId))
  ipcMain.handle(IPC_CHANNELS.modelsRefresh, (_e, harnessId?: string) => refreshAvailableModels(harnessId))

  ipcMain.handle(IPC_CHANNELS.draftsGet, (_e, sessionLocalId: string) =>
    getDraft(sessionLocalId))
  ipcMain.handle(IPC_CHANNELS.draftsSet, (_e, sessionLocalId: string, text: string, attachments: Attachment[]) =>
    setDraft(sessionLocalId, text, attachments))
  ipcMain.handle(IPC_CHANNELS.draftsClear, (_e, sessionLocalId: string) =>
    clearDraft(sessionLocalId))

  ipcMain.handle(IPC_CHANNELS.statsGetAll, () => getAllStats())
  ipcMain.handle(IPC_CHANNELS.statsUpsert, (
    _e,
    sessionLocalId: string,
    totalTokens: number,
    totalCostUsd: number,
    turnCount: number,
    inProgressTokens: number,
  ) => upsertStats(sessionLocalId, totalTokens, totalCostUsd, turnCount, inProgressTokens))
  ipcMain.handle(IPC_CHANNELS.statsImportLegacy, (_e, entries: SessionStatRow[]) => {
    if (isStatsImported()) return
    for (const e of entries) {
      upsertStats(e.sessionLocalId, e.totalTokens, e.totalCostUsd, e.turnCount, e.inProgressTokens)
    }
    markStatsImported()
  })

  ipcMain.handle(IPC_CHANNELS.performanceGetSummary, (_e, opts: { projectPath: string | null; rangeDays: number }) => {
    try {
      return getPerformanceSummary(opts)
    } catch (err) {
      console.error('[ipc] performance:getSummary failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  if (!app.isPackaged) {
    ipcMain.handle(IPC_CHANNELS.devRunMigrations, () => {
      const result = runMigrations(app.getVersion())
      console.log(`[dev] migrations: ${result.applied.length} applied`)
      return { applied: result.applied.length }
    })
  }

  // Provider-neutral work item bridge. The registry routes directly to the
  // installed provider identified by sourceId.
  ipcMain.handle(IPC_CHANNELS.workItemsList, async (_event, sourceId?: string) => {
    try {
      return await registry.list(sourceId)
    } catch (err) {
      console.error('[ipc] workItems:list failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.workItemsGet, async (_event, reference: { sourceId: string; itemId: string }) => {
    try {
      return await registry.get(reference)
    } catch (err) {
      console.error('[ipc] workItems:get failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.workItemsUpdateStatus,
    async (_event, reference: { sourceId: string; itemId: string }, status: WorkItemStatus) => {
      try {
        return await registry.updateStatus(reference, status)
      } catch (err) {
        console.error('[ipc] workItems:updateStatus failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.workItemsGetTransitions, async (_event, reference: { sourceId: string; itemId: string }) => {
    try {
      return await registry.getTransitions(reference)
    } catch (err) {
      console.error('[ipc] workItems:getTransitions failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.workItemsTransition,
    async (_event, reference: { sourceId: string; itemId: string }, name: string) => {
      try {
        return await registry.transition(reference, name)
      } catch (err) {
        console.error('[ipc] workItems:transition failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.workItemsCreate,
    async (_event, sourceId: string, params: WorkItemCreateParams) => {
      try {
        return await registry.create(sourceId, params)
      } catch (err) {
        console.error('[ipc] workItems:create failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Harness
  ipcMain.handle(IPC_CHANNELS.harnessListAdapters, async (): Promise<HarnessInfo[]> => {
    const adapters = harnessRegistry.list()
    return Promise.all(adapters.map(async (a) => {
      const avail = await a.probeAvailability()
      return {
        id: a.id,
        name: a.name,
        available: avail.available,
        unavailableReason: avail.reason,
        defaultModel: await getDefaultModel(a.id),
      capabilities: await getCapabilities(a.id),
      configuration: a.configuration,
      authentication: a.authentication,
      }
    }))
  })

  ipcMain.handle(IPC_CHANNELS.harnessGetActive, async (): Promise<HarnessInfo> => {
    const active = getHarness()
    const avail = await active.probeAvailability()
    return {
      id: active.id,
      name: active.name,
      available: avail.available,
      unavailableReason: avail.reason,
      defaultModel: await getDefaultModel(active.id),
      capabilities: await getCapabilities(active.id),
      configuration: active.configuration,
      authentication: active.authentication,
    }
  })

  ipcMain.handle(IPC_CHANNELS.harnessSetActive, async (_e, id: string): Promise<void> => {
    harnessRegistry.setDefault(id)
    settingsStore.set({ harnessId: id })
  })

  ipcMain.handle(IPC_CHANNELS.harnessAuth, async (): Promise<HarnessAuthInfo[]> => {
    const adapters = harnessRegistry.list()
    return Promise.all(adapters.map(async (a) => {
      if (a.probeAuthDetail) {
        return { id: a.id, ...(await a.probeAuthDetail()) }
      }
      const auth = await a.resolveAuth()
      if (auth.type === 'api-key' && auth.key) {
        return { id: a.id, type: 'api-key', status: 'authenticated', detail: 'API key configured.' }
      }
      return { id: a.id, type: 'cli', status: 'unknown', detail: 'Relies on the binary’s own login.' }
    }))
  })

  ipcMain.handle(IPC_CHANNELS.harnessConfigGet, async (_e, id: string): Promise<HarnessConfigurationState> => {
    const adapter = getHarness(id)
    const values = settingsStore.get().harnessConfig?.[id] ?? {}
    const secretFields: string[] = []
    for (const field of adapter.configuration?.fields ?? []) {
      if (field.type === 'secret' && await harnessSecrets.has(id, field.id)) secretFields.push(field.id)
    }
    return { values, secretFields }
  })

  ipcMain.handle(IPC_CHANNELS.harnessConfigSet, (_e, id: string, values: Record<string, string | boolean>) => {
    const adapter = getHarness(id)
    const allowed = new Set((adapter.configuration?.fields ?? []).filter((f) => f.type !== 'secret').map((f) => f.id))
    const sanitized = Object.fromEntries(Object.entries(values).filter(([key, value]) => allowed.has(key) && (typeof value === 'string' || typeof value === 'boolean')))
    const current = settingsStore.get().harnessConfig ?? {}
    settingsStore.set({ harnessConfig: { ...current, [id]: sanitized } })
    invalidateAvailableModels(id)
  })

  ipcMain.handle(IPC_CHANNELS.harnessConfigSecretSet, async (_e, id: string, fieldId: string, value: string) => {
    const field = getHarness(id).configuration?.fields.find((candidate) => candidate.id === fieldId)
    if (field?.type !== 'secret') throw new Error(`Unknown secret field '${fieldId}' for harness '${id}'`)
    await harnessSecrets.set(id, fieldId, value)
    invalidateAvailableModels(id)
  })

  ipcMain.handle(IPC_CHANNELS.harnessConfigSecretDelete, async (_e, id: string, fieldId: string) => {
    const field = getHarness(id).configuration?.fields.find((candidate) => candidate.id === fieldId)
    if (field?.type !== 'secret') throw new Error(`Unknown secret field '${fieldId}' for harness '${id}'`)
    await harnessSecrets.delete(id, fieldId)
    invalidateAvailableModels(id)
  })

  ipcMain.handle(IPC_CHANNELS.harnessAuthAction, async (_e, id: string) => {
    const adapter = getHarness(id)
    const command = adapter.authentication?.login
    if (!command) throw new Error(`${adapter.name} does not provide an authentication action.`)
    return adapter.runCLI(command.args)
  })

  registerTerminalHandlers()

  ipcMain.handle(
    IPC_CHANNELS.notificationsTrigger,
    (_event, sessionLocalId: string, sessionTitle: string, silent: boolean) => {
      if (!Notification.isSupported()) return
      const win = BrowserWindow.getAllWindows()[0]
      if (!win) return
      const n = new Notification({
        title: 'Session complete',
        body: sessionTitle || sessionLocalId,
        silent,
      })
      n.on('click', () => {
        win.show()
        win.focus()
        win.webContents.send(IPC_CHANNELS.notificationsNavigate, sessionLocalId)
      })
      n.show()
    },
  )

  startHarnessPluginWatcher()

  ipcMain.handle('mobile:generateKey', () => randomBytes(32).toString('hex'))
  ipcMain.handle('mobile:getLocalIp', () => {
    const ifaces = os.networkInterfaces()
    for (const iface of Object.values(ifaces)) {
      for (const addr of iface ?? []) {
        if (addr.family === 'IPv4' && !addr.internal) return addr.address
      }
    }
    return '127.0.0.1'
  })
}

function broadcastCommandsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.commandsChanged)
  }
}

/**
 * Watch the active harness's installed_plugins.json and settings.json for
 * changes and broadcast commands:changed so the renderer reloads the list
 * without requiring an app restart.
 */
function startHarnessPluginWatcher(): void {
  const targets = [
    path.join(getHarness().getPluginsDir(), 'installed_plugins.json'),
    getHarness().getSettingsPath(),
  ]

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  function schedulebroadcast(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(broadcastCommandsChanged, 200)
  }

  for (const target of targets) {
    try {
      fsWatch(target, schedulebroadcast)
    } catch {
      // File may not exist yet (e.g. no plugins installed); ignore.
    }
  }
}

export function wirePluginEventRelay(win: BrowserWindow): void {
  const bus = getPluginEventBus()
  if (!bus) return
  const events: (keyof EventMap)[] = [
    'plugin.healthy',
    'plugin.unhealthy',
    'plugin.activated',
    'plugin.deactivated',
    'plugin.updated',
    'plugin.uninstalled',
    'task.selected',
    'job.started',
    'job.completed',
    'job.failed',
    'session.started',
    'session.completed',
    'settings.changed',
  ]
  for (const event of events) {
    bus.on(event, (payload) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.pluginEvent, event, payload)
    })
  }
}
