import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionsListQuery } from '@/composables/useSessionsListQuery'
import { projectColor } from '@/lib/projectColor'
import type { LiveSessionStatus } from '@shared/ipc-contract'

export type UnifiedSessionSource = 'live' | 'persisted' | 'historical'

/**
 * Normalized entry for one session regardless of backing store. Single source of
 * truth for the home list and the session rail so both surfaces stay consistent.
 */
export interface UnifiedSession {
  localId: string
  title: string
  status: LiveSessionStatus | 'inactive'
  source: UnifiedSessionSource
  isDraft: boolean
  /** null = no-project (general) session. */
  projectPath: string | null
  projectName: string
  projectColor: string
  workItemKey: string | null
  workItemTitle: string | null
  initialPrompt: string
  lastActivityAt: number
  lastUserMessageAt: number | null
  model: string | null
  branch: string | null
  agencyName: string | null
  messageCount: number | null
}

export function useUnifiedSessions() {
  const router = useRouter()
  const sessionStore = useSessionStore()
  const { projects } = useProjectsQuery()
  const { persistedSessions, historicalSessions, isLoading, invalidateAll, invalidateForProject } =
    useSessionsListQuery(projects)

  // Persisted rows that are already live (e.g. started before the store
  // subscribed) need an in-memory entry so the chat can stream into them.
  watch(
    persistedSessions,
    (sessions) => {
      for (const s of sessions) {
        if ((s.status === 'running' || s.status === 'starting') && !sessionStore.getSession(s.localId)) {
          sessionStore.trackRunning(s)
        }
      }
    },
    { immediate: true },
  )

  function pathToProjectName(projectPath: string | null): string {
    if (!projectPath) return ''
    const found = projects.value.find((p) => p.path === projectPath)
    if (found) return found.name
    return projectPath.split('/').pop() ?? projectPath
  }

  const unifiedSessions = computed<UnifiedSession[]>(() => {
    const inMemory = Object.values(sessionStore.sessions)
    const memoryIds = new Set(inMemory.map((s) => s.localId))
    // Historical JSONL rows already open in-memory would duplicate a live session.
    const memorySdkIds = new Set(
      inMemory.flatMap((s) => s.agents.map((a) => a.sdkSessionId)).filter((id): id is string => id !== null),
    )

    const live: UnifiedSession[] = inMemory.map((s) => {
      const projectName = pathToProjectName(s.projectPath)
      return {
        localId: s.localId,
        title:
          s.workItemTitle ??
          s.title ??
          s.agencyPrompt ??
          (s.initialPrompt.trim() || (s.isDraft ? 'New draft' : '(no messages)')),
        status: s.status,
        source: 'live' as const,
        isDraft: s.isDraft,
        projectPath: s.projectPath,
        projectName,
        projectColor: projectColor(projectName),
        workItemKey: s.workItemKey,
        workItemTitle: s.workItemTitle,
        initialPrompt: s.initialPrompt,
        lastActivityAt: s.lastActivityAt,
        lastUserMessageAt: s.lastUserMessageAt,
        model: s.model,
        branch: s.branch,
        agencyName: s.agencyName,
        messageCount: null,
      }
    })

    const previous: UnifiedSession[] = persistedSessions.value
      .filter((s) => !memoryIds.has(s.localId))
      .map((s) => {
        const projectName = pathToProjectName(s.projectPath)
        return {
          localId: s.localId,
          title: s.workItemTitle ?? s.title ?? (s.initialPrompt.trim() || '(no messages)'),
          status: s.status,
          source: 'persisted' as const,
          isDraft: false,
          projectPath: s.projectPath,
          projectName,
          projectColor: projectColor(projectName),
          workItemKey: s.workItemKey,
          workItemTitle: s.workItemTitle,
          initialPrompt: s.initialPrompt,
          lastActivityAt: s.lastActivityAt,
          lastUserMessageAt: s.lastUserMessageAt,
          model: s.model,
          branch: s.branch,
          agencyName: s.agencyName,
          messageCount: null,
        }
      })

    const historical: UnifiedSession[] = historicalSessions.value
      .filter(({ summary: s }) => !memorySdkIds.has(s.id))
      .map(({ projectPath, summary: s }) => {
        const projectName = pathToProjectName(projectPath)
        return {
          localId: s.id,
          title: s.firstUserMessage ?? '(no user message)',
          status: 'inactive' as const,
          source: 'historical' as const,
          isDraft: false,
          projectPath,
          projectName,
          projectColor: projectColor(projectName),
          workItemKey: null,
          workItemTitle: null,
          initialPrompt: s.firstUserMessage ?? '',
          lastActivityAt: s.lastActivityAt,
          lastUserMessageAt: null,
          model: s.model,
          branch: s.gitBranch,
          agencyName: null,
          messageCount: s.messageCount,
        }
      })

    return [...live, ...previous, ...historical].sort(
      (a, b) => (b.lastUserMessageAt ?? b.lastActivityAt) - (a.lastUserMessageAt ?? a.lastActivityAt),
    )
  })

  /** Open a session in the chat. The session carries its own project context —
   *  no app-wide focus to set. */
  function open(entry: UnifiedSession): void {
    switch (entry.source) {
      case 'live':
        void router.push(`/sessions/${entry.localId}`)
        break
      case 'persisted': {
        const persisted = persistedSessions.value.find((p) => p.localId === entry.localId)
        if (persisted) {
          sessionStore.openPersisted(persisted)
          void router.push(`/sessions/${entry.localId}`)
        }
        break
      }
      case 'historical': {
        const hist = historicalSessions.value.find(({ summary: s }) => s.id === entry.localId)
        if (hist) {
          sessionStore.openHistorical(hist.projectPath, hist.summary)
          void router.push(`/sessions/${entry.localId}`)
        }
        break
      }
    }
  }

  /** Delete an entry regardless of its backing store. */
  async function remove(entry: UnifiedSession): Promise<void> {
    switch (entry.source) {
      case 'live':
        await window.agentkeeper.sessions.terminate(entry.localId)
        sessionStore.dismiss(entry.localId)
        break
      case 'persisted':
        await window.agentkeeper.sessions.deletePersisted(entry.localId)
        invalidateForProject(entry.projectPath)
        break
      case 'historical':
        await window.agentkeeper.sessions.deleteHistorical(entry.projectPath, entry.localId)
        invalidateForProject(entry.projectPath)
        break
    }
  }

  /** Create (or focus) a draft. Defaults to a no-project draft — context is
   *  now a per-session choice made in the compose header, not inherited from
   *  an app-wide focus. */
  async function createNewSession(): Promise<string | null> {
    const settings = await window.agentkeeper.settings.get()
    const localId = sessionStore.createOrFocusDraft({
      projectPath: null,
      defaultModel: settings.defaultModel,
      defaultEffort: settings.defaultEffort,
      defaultUseWorktree: settings.defaultUseWorktree,
    })
    void router.push(`/sessions/${localId}`)
    return localId
  }

  return {
    unifiedSessions,
    isLoading,
    invalidateAll,
    open,
    remove,
    createNewSession,
  }
}
