import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { EventMap } from '@orchestral/sdk'
import path from 'node:path'
import {
  IPC_CHANNELS,
  type AppSettings,
  type CreatePRParams,
  type MergeMethod,
  type PRFilters,
  type RecentProject,
  type ReviewEvent,
  type SecretKeyName,
  type StartSessionParams,
  type WorkItemCreateParams,
  type WorkItemStatus,
} from '../shared/ipc-contract'
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
} from '@orchestral/plugin-github/src/github-cli'
import type { WorkItemRegistryFull } from './plugins'
import { getPluginConfig, getPluginEventBus, setPluginConfig } from './plugins'
import { detectGithubRepo, recentProjectsStore } from './store'
import { listSessions, readSession } from './sessions'
import { interruptSession, terminateSession, resumeSession, sendInput, startSession } from './agent'
import { SECRET_KEYS, secrets } from './secrets'
import { settingsStore } from './settings'
import { createWorktree, listWorktrees, removeWorktree } from './worktrees'
import { deleteRole, listRoles, saveRole } from './roles'
import { deleteAgency, listAgencies, saveAgency } from './agencies'
import { resumeAgency, startAgency } from './orchestrator'
import * as sessionRegistry from './session-registry'
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
      // auto-register GitHub repo if detected and not already in config
      if (repo) {
        const cfg = (await getPluginConfig('github')) as { repos?: string[]; repo?: string }
        const repos: string[] = cfg.repos ?? (cfg.repo ? [cfg.repo] : [])
        if (!repos.includes(repo)) {
          await setPluginConfig('github', { repos: [...repos, repo] })
        }
      }
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
  ipcMain.handle(IPC_CHANNELS.projectsPickFolder, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
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
        await sendInput(sessionId, text)
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
        await interruptSession(sessionId)
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

  // Plugin config
  ipcMain.handle(IPC_CHANNELS.pluginsConfigGet, (_event, pluginId: string) =>
    getPluginConfig(pluginId),
  )
  ipcMain.handle(
    IPC_CHANNELS.pluginsConfigSet,
    async (_event, pluginId: string, config: unknown) => {
      try {
        return await setPluginConfig(pluginId, config)
      } catch (err) {
        console.error('[ipc] plugins:config:set failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )

  // GitHub — config + PR channels
  async function getGithubRepos(): Promise<string[]> {
    const cfg = (await getPluginConfig('github')) as { repos?: string[]; repo?: string }
    if (cfg.repos) return cfg.repos
    if (cfg.repo) return [cfg.repo]
    return []
  }

  ipcMain.handle(IPC_CHANNELS.githubConfigGet, async () => {
    const repos = await getGithubRepos()
    return { repos }
  })
  ipcMain.handle(IPC_CHANNELS.githubConfigSet, async (_event, config: { repos: string[] }) => {
    try {
      return await setPluginConfig('github', config)
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
  // Prune expired entries once at startup using the current setting.
  {
    const { sessionExpiryDays } = settingsStore.get()
    sessionRegistry.pruneExpired(sessionExpiryDays)
  }

  ipcMain.handle(
    IPC_CHANNELS.sessionsListPersisted,
    (_event, projectPath: string) => sessionRegistry.listSessions(projectPath),
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsResume,
    async (_event, localId: string) => {
      try {
        return await resumeSession(localId)
      } catch (err) {
        console.error('[ipc] sessions:resume failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.sessionsDeletePersisted,
    (_event, localId: string) => {
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
    IPC_CHANNELS.agenciesListPersisted,
    (_event, projectPath: string) => sessionRegistry.listAgencies(projectPath),
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
    IPC_CHANNELS.agenciesDeletePersisted,
    (_event, instanceId: string) => {
      sessionRegistry.deleteAgency(instanceId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.agenciesTouchPersisted,
    (_event, instanceId: string) => {
      sessionRegistry.touchAgency(instanceId)
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
  ipcMain.handle(IPC_CHANNELS.workItemsGetTransitions, async (_event, id: string) => {
    try {
      return await registry.getTransitions(id)
    } catch (err) {
      console.error('[ipc] workItems:getTransitions failed:', err)
      throw new Error(err instanceof Error ? err.message : String(err))
    }
  })
  ipcMain.handle(
    IPC_CHANNELS.workItemsTransition,
    async (_event, id: string, name: string) => {
      try {
        return await registry.transition(id, name)
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
        return await registry.create(params)
      } catch (err) {
        console.error('[ipc] workItems:create failed:', err)
        throw new Error(err instanceof Error ? err.message : String(err))
      }
    },
  )
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
