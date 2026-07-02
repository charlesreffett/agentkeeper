import { app, BrowserWindow, dialog, ipcMain, Notification } from 'electron'
import type { EventMap } from '@agentkeeper/sdk'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { watch as fsWatch } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import {
  IPC_CHANNELS,
  type AddAgentParams,
  type AppSettings,
  type Attachment,
  type CreatePRParams,
  type CreateProjectParams,
  type DayTotal,
  type HarnessInfo,
  type MergeMethod,
  type PRFilters,
  type PluginSource,
  type RecentProject,
  type ReviewEvent,
  type SecretKeyName,
  type StartSessionParams,
  type WorkItemCreateParams,
  type WorkItemStatus,
} from '../shared/ipc-contract'
import * as costLedger from './cost-ledger'
import { getDraft, setDraft, clearDraft } from './drafts'
import { getAllStats, upsertStats, markStatsImported, isStatsImported, flushInProgressTokens } from './stats'
import { getDb, runMigrations } from './db/index'
import { jiraTicketActivity } from './db/schema'
import { sql, eq, desc } from 'drizzle-orm'
import type { SessionStatRow } from '../shared/ipc-contract'
import { getAllPricing, refreshFromLiteLLM } from './pricing'
import {
  addComment as ghAddComment,
  createPR as ghCreatePR,
  getPR as ghGetPR,
  getPRChecks as ghGetPRChecks,
  getPRComments as ghGetPRComments,
  getPRDiff as ghGetPRDiff,
  listPRs as ghListPRs,
  mergePR as ghMergePR,
  submitReview as ghSubmitReview,
} from '@agentkeeper/plugin-github/src/github-cli'
import { listProjects as jiraListProjects } from '@agentkeeper/plugin-jira'
import { JiraWorkItemSource } from '@agentkeeper/plugin-jira/src/jira-source'
import { countIssues as jiraCountIssues } from '@agentkeeper/plugin-jira/src/jira-cli'
import type { WorkItemRegistryFull } from './plugins'
import { getPluginConfig, getPluginEventBus, setPluginConfig } from './plugins'
import {
  cancelAkpInstall,
  checkForUpdates,
  confirmAkpInstall,
  disablePlugin,
  enablePlugin,
  installPlugin,
  installPluginFromUrl,
  listPlugins,
  loadDevPlugin,
  prepareAkpInstall,
  uninstallPlugin,
  unloadDevPlugin,
  updatePlugin,
} from './plugin-manager.js'
import { getActiveHost } from './plugin-loader.js'
import { getRawSqlite } from './db/index'
import { detectGithubRepo, recentProjectsStore } from './store'
import { commit, createBranch, detectRemoteSources, getBranch, getStatus, listBranches, pull, push, stageFiles, switchBranch, switchBranchCreate, unstageFiles } from './git'
import { suggestCommits } from './git-ai'
import { listSessions, readSession, deleteHistoricalSession, deleteAllHistoricalSessions } from './sessions'
import { interruptSession, terminateSession, resumeSession, sendInput, startSession, setModel, setEffort, setPermissionMode, isSessionActive, reconnectSessionMcp, editAndRerun, undoEditAndRerun } from './agent'
import { SECRET_KEYS, secrets, resolveClaudeAuth } from './secrets'
import { settingsStore } from './settings'
import { createWorktree, gitDiffStat, listWorktrees, removeWorktree } from './worktrees'
import { deleteRole, generateRoleContent, listRoles, saveRole } from './roles'
import { deleteAgency, listAgencies, saveAgency } from './agencies'
import { generateAndPersistSessionTitle, isAgencyRuntimeActive, resumeAgency, startAgency, createProjectMcp, createOrchestratorMcp } from './orchestrator'
import * as sessionRegistry from './session-registry'
import { executeReset } from './reset'
import { generateSkillContent, installSkill, listSkills, previewSkills, removeSkill, saveSkill } from './skills'
import { listCommands, removeCommand, saveCommand, generateCommandContent } from './commands'
import { listPlans, getPlan, createPlan, updatePlan, deletePlan, removeSessionFromPlans, removeAllSessionsFromPlans } from './plans'
import { harnessRegistry, getHarness } from './harness/index'
import { syncMobileServer } from './mobile-server'
import { startWatching, stopWatching } from './watcher.js'
import { registerTerminalHandlers } from './terminal'
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
    repo: await detectGithubRepo(projectPath),
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
  // Projects (registry)
  ipcMain.handle(IPC_CHANNELS.projectsAdd, async (_event, projectPath: string) => {
    try {
      const repo = await detectGithubRepo(projectPath)
      const existing = recentProjectsStore.list().find((p) => p.path === projectPath)
      const project: RecentProject = {
        path: projectPath,
        name: path.basename(projectPath),
        repo: existing?.repo ?? repo,
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
    const repo = await detectGithubRepo(projectPath)
    const project: RecentProject = {
      path: projectPath,
      name: params.name,
      repo,
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
  ipcMain.handle(IPC_CHANNELS.sessionsList, (_event, projectPath: string) =>
    listSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsRead,
    (_event, projectPath: string, sessionId: string, harnessId?: string) => readSession(projectPath, sessionId, harnessId),
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
          mcpFactory: () => createProjectMcp(params.projectPath),
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
    (_event, partial: Partial<AppSettings>) => {
      const updated = settingsStore.set(partial)
      syncMobileServer(updated)
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
    async (_event, skill: Skill) => {
      try {
        return await removeSkill(skill)
      } catch (err) {
        console.error('[ipc] skills:remove failed:', err)
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

  // Auth
  ipcMain.handle(IPC_CHANNELS.authStatus, async () => {
    const auth = await resolveClaudeAuth()
    return auth.type
  })

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

  // Plugin config
  ipcMain.handle(IPC_CHANNELS.pluginsConfigGet, (_event, pluginId: string) =>
    getPluginConfig(pluginId, getRawSqlite()),
  )
  ipcMain.handle(
    IPC_CHANNELS.pluginsConfigSet,
    async (_event, pluginId: string, config: unknown) => {
      try {
        return await setPluginConfig(pluginId, config, getRawSqlite())
      } catch (err) {
        console.error('[ipc] plugins:config:set failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // Plugin management
  ipcMain.handle(IPC_CHANNELS.pluginsList, () => {
    const rows = listPlugins()
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      version: row.version,
      enabled: row.enabled === 1,
      source: row.source as PluginSource,
      status: getActiveHost(row.id) ? 'active' : (row.enabled === 1 && row.source === 'bundled' ? 'active' : 'inactive'),
      manifest: JSON.parse(row.manifest),
    }))
  })

  ipcMain.handle(IPC_CHANNELS.pluginsPickAkpFile, async (): Promise<string | null> => {
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

  ipcMain.handle(IPC_CHANNELS.pluginsInstall, async (_event, akpPath?: string): Promise<void> => {
    try {
      let filePath = akpPath
      if (!filePath) {
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
        if (result.canceled || !result.filePaths[0]) return
        filePath = result.filePaths[0]
      }
      await installPlugin(filePath)
    } catch (err) {
      console.error('[ipc] plugins:install failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsInstallFromUrl, async (_event, manifestUrl: string) => {
    try {
      await installPluginFromUrl(manifestUrl)
    } catch (err) {
      console.error('[ipc] plugins:installFromUrl failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsPrepareAkpInstall, async (_event, opts: { filePath?: string; manifestUrl?: string }) => {
    try {
      return await prepareAkpInstall(opts)
    } catch (err) {
      console.error('[ipc] plugins:prepareAkpInstall failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsConfirmAkpInstall, async (_event, token: string) => {
    try {
      await confirmAkpInstall(token)
    } catch (err) {
      console.error('[ipc] plugins:confirmAkpInstall failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsCancelAkpInstall, (_event, token: string) => {
    cancelAkpInstall(token)
  })

  ipcMain.handle(IPC_CHANNELS.pluginsLoadDev, async (_event, dirPath?: string) => {
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
      await loadDevPlugin(resolvedPath)
    } catch (err) {
      console.error('[ipc] plugins:loadDev failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsUnloadDev, async (_event, pluginId: string) => {
    try {
      await unloadDevPlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:unloadDev failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsUninstall, async (_event, pluginId: string) => {
    try {
      await uninstallPlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:uninstall failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsEnable, async (_event, pluginId: string) => {
    try {
      await enablePlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:enable failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsDisable, async (_event, pluginId: string) => {
    try {
      await disablePlugin(pluginId)
    } catch (err) {
      console.error('[ipc] plugins:disable failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.pluginsCheckUpdates, async () => {
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

  ipcMain.handle(IPC_CHANNELS.pluginsUpdate, async (_event, pluginId: string) => {
    try {
      const updates = await checkForUpdates()
      const entry = updates.find((u) => u.pluginId === pluginId)
      if (!entry) throw new Error(`No update available for plugin ${pluginId}`)
      await updatePlugin(pluginId, entry.release)
    } catch (err) {
      console.error('[ipc] plugins:update failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  // Remote sources
  ipcMain.handle(IPC_CHANNELS.remotesDetect, (_event, projectPath: string) =>
    detectRemoteSources(projectPath),
  )

  // GitHub — config + PR channels
  async function getGithubRepos(): Promise<string[]> {
    const projects = recentProjectsStore.list()
    return [...new Set(projects.map((p) => p.repo).filter((r): r is string => Boolean(r)))]
  }

  ipcMain.handle(IPC_CHANNELS.githubConfigGet, async () => {
    const repos = await getGithubRepos()
    return { repos }
  })
  ipcMain.handle(IPC_CHANNELS.githubConfigSet, async (_event, config: { repos: string[] }) => {
    try {
      return await setPluginConfig('github', config, getRawSqlite())
    } catch (err) {
      console.error('[ipc] github:config:set failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.githubListPRs, async (_event, filters: PRFilters) => {
    try {
      const repos = await getGithubRepos()
      const targets = filters.repo ? [filters.repo] : repos
      if (targets.length === 0) return []
      const results = await Promise.all(targets.map((r) => ghListPRs(r, filters)))
      const flat = results.flat()
      flat.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      return flat
    } catch (err) {
      console.error('[ipc] github:prs:list failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.githubGetPR, async (_event, repo: string, number: number) => {
    try {
      return await ghGetPR(repo, number)
    } catch (err) {
      console.error('[ipc] github:prs:get failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.githubGetPRDiff, async (_event, repo: string, number: number) => {
    try {
      return await ghGetPRDiff(repo, number)
    } catch (err) {
      console.error('[ipc] github:prs:diff failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.githubGetPRChecks, async (_event, repo: string, number: number) => {
    try {
      return await ghGetPRChecks(repo, number)
    } catch (err) {
      console.error('[ipc] github:prs:checks failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.githubGetPRComments, async (_event, repo: string, number: number) => {
    try {
      return await ghGetPRComments(repo, number)
    } catch (err) {
      console.error('[ipc] github:prs:comments failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.githubAddComment,
    async (_event, repo: string, number: number, body: string) => {
      try {
        return await ghAddComment(repo, number, body)
      } catch (err) {
        console.error('[ipc] github:prs:comment failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.githubSubmitReview,
    async (_event, repo: string, number: number, event: ReviewEvent, body: string) => {
      try {
        return await ghSubmitReview(repo, number, event, body)
      } catch (err) {
        console.error('[ipc] github:prs:review failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.githubMergePR,
    async (_event, repo: string, number: number, method: MergeMethod) => {
      try {
        return await ghMergePR(repo, number, method)
      } catch (err) {
        console.error('[ipc] github:prs:merge failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.githubCreatePR, async (_event, params: CreatePRParams) => {
    try {
      return await ghCreatePR(params.repo, params)
    } catch (err) {
      console.error('[ipc] github:prs:create failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  // Session registry — persisted sessions + resume + delete + touch
  // Reset any sessions left mid-flight by a previous process, then prune old ones.
  sessionRegistry.resetStaleRunning()
  flushInProgressTokens()
  {
    const { sessionExpiryDays } = settingsStore.get()
    sessionRegistry.pruneExpired(sessionExpiryDays)
  }

  ipcMain.handle(
    IPC_CHANNELS.sessionsListPersisted,
    (_event, projectPath: string) => sessionRegistry.listSessions(projectPath),
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
    async (_event, localId: string, model: string) => {
      try {
        return await setModel(localId, model)
      } catch (err) {
        console.error('[ipc] sessions:setModel failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
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
    (_event, projectPath: string, sessionId: string) =>
      deleteHistoricalSession(projectPath, sessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeleteAllHistorical,
    (_event, projectPath: string) => deleteAllHistoricalSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeleteAllPersisted,
    async (_event, projectPath: string) => {
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
    (_event, projectPath: string) => sessionRegistry.listTrackedSdkIds(projectPath),
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
          { mcpFactory: () => createProjectMcp(session.projectPath) },
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
        if (!persistedSession?.agencyId) throw new Error(`Session ${agentLocalId} has no agency — no MCP to reconnect`)
        const factory = () => createOrchestratorMcp(persistedSession.projectPath, agentLocalId)
        return await reconnectSessionMcp(agentLocalId, factory)
      } catch (err) {
        console.error('[ipc] sessions:reconnectMcp failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsEditAndRerun,
    async (_event, agentLocalId: string, truncateFromUuid: string, newText: string, originalText?: string | null) => {
      try {
        await editAndRerun(agentLocalId, truncateFromUuid, newText, originalText)
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

  // Enforced here (not only in the renderer) — the mobile companion and future
  // callers hit the same channel. Switching HEAD under a running agent corrupts
  // its pinned-branch assumptions. Path comparison, not project identity:
  // sessions in worktree dirs have their own HEAD and must not block.
  function hasLiveSessionAt(projectPath: string): boolean {
    const LIVE = new Set(['running', 'starting', 'blocked'])
    return sessionRegistry
      .listAllSessions()
      .some((s) => (s.worktreePath ?? s.projectPath) === projectPath && LIVE.has(s.status ?? ''))
  }

  ipcMain.handle(
    IPC_CHANNELS.gitSwitchBranch,
    (_event, projectPath: string, name: string, opts?: SwitchBranchOptions): Promise<SwitchResult> | SwitchResult => {
      if (hasLiveSessionAt(projectPath)) return { ok: false, blocked: 'live-session' }
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

  if (!app.isPackaged) {
    ipcMain.handle(IPC_CHANNELS.devRunMigrations, () => {
      const db = getDb()
      const count = () =>
        (db.get<{ n: number }>(sql`SELECT count(*) as n FROM __drizzle_migrations`) ?? { n: 0 }).n
      const before = count()
      runMigrations()
      const applied = count() - before
      console.log(`[dev] migrations: ${applied} applied`)
      return { applied }
    })
  }

  // Work items — Jira runs in-main (like jira:listProjects), bypassing the worker
  // plugin route whose unreliable PATH/config delivery returned 0 issues. Config is
  // read under the 'jira' id, matching what the settings panel writes.
  async function jiraSource(): Promise<JiraWorkItemSource> {
    const cfg = (await getPluginConfig('jira', getRawSqlite())) as {
      projectMappings?: Array<{ jiraProjectKey: string; projectPath: string }>
      projectKey?: string
    }
    return new JiraWorkItemSource(cfg.projectMappings ?? [], cfg.projectKey)
  }

  ipcMain.handle(IPC_CHANNELS.workItemsList, async () => {
    try {
      return await (await jiraSource()).list()
    } catch (err) {
      console.error('[ipc] workItems:list failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(IPC_CHANNELS.workItemsGet, async (_event, id: string) => {
    try {
      return await (await jiraSource()).get(id)
    } catch (err) {
      console.error('[ipc] workItems:get failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.workItemsUpdateStatus,
    async (_event, id: string, status: WorkItemStatus) => {
      try {
        return await (await jiraSource()).updateStatus(id, status)
      } catch (err) {
        console.error('[ipc] workItems:updateStatus failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.workItemsGetTransitions, async (_event, id: string) => {
    try {
      return await (await jiraSource()).getTransitions(id)
    } catch (err) {
      console.error('[ipc] workItems:getTransitions failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.workItemsTransition,
    async (_event, id: string, name: string) => {
      try {
        return await (await jiraSource()).transition(id, name)
      } catch (err) {
        console.error('[ipc] workItems:transition failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.workItemsCreate,
    async (_event, params: WorkItemCreateParams) => {
      try {
        return await (await jiraSource()).create(params)
      } catch (err) {
        console.error('[ipc] workItems:create failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  ipcMain.handle(IPC_CHANNELS.workItemsCounts, async (_event, boards: string[]) => {
    const entries = await Promise.all(
      boards.map(async (key) => [key, await jiraCountIssues(key)] as const),
    )
    return Object.fromEntries(entries.filter((e): e is [string, number] => e[1] != null))
  })

  ipcMain.handle(IPC_CHANNELS.jiraListProjects, async () => {
    try {
      return await jiraListProjects()
    } catch (err) {
      console.error('[ipc] jira:listProjects failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })

  ipcMain.handle(IPC_CHANNELS.jiraActivityList, (_e, ticketRef: string) => {
    return getDb()
      .select()
      .from(jiraTicketActivity)
      .where(eq(jiraTicketActivity.ticketRef, ticketRef))
      .orderBy(desc(jiraTicketActivity.createdAt))
      .all()
      .map((r) => ({ id: r.id, ticketRef: r.ticketRef, actor: r.actor, message: r.message, createdAt: r.createdAt }))
  })

  ipcMain.handle(IPC_CHANNELS.jiraActivityAdd, (_e, entry: { ticketRef: string; actor: string; message: string }) => {
    const row = { id: randomUUID(), ticketRef: entry.ticketRef, actor: entry.actor, message: entry.message, createdAt: Date.now() }
    getDb().insert(jiraTicketActivity).values(row).run()
    return row
  })

  // Harness
  ipcMain.handle(IPC_CHANNELS.harnessListAdapters, async (): Promise<HarnessInfo[]> => {
    const adapters = harnessRegistry.list()
    return Promise.all(adapters.map(async (a) => ({
      id: a.id,
      name: a.name,
      available: await a.isAvailable(),
      defaultModel: a.defaultModel,
    })))
  })

  ipcMain.handle(IPC_CHANNELS.harnessGetActive, async (): Promise<HarnessInfo> => {
    const active = getHarness()
    return {
      id: active.id,
      name: active.name,
      available: await active.isAvailable(),
      defaultModel: active.defaultModel,
    }
  })

  ipcMain.handle(IPC_CHANNELS.harnessSetActive, async (_e, id: string): Promise<void> => {
    harnessRegistry.setDefault(id)
    settingsStore.set({ harnessId: id })
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
    'task.selected',
    'job.started',
    'job.completed',
    'job.failed',
    'session.started',
    'session.completed',
    'pr.opened',
    'pr.merged',
    'settings.changed',
  ]
  for (const event of events) {
    bus.on(event, (payload) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.pluginEvent, event, payload)
    })
  }
}
