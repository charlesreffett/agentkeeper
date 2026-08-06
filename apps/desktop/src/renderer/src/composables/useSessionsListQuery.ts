import { computed } from 'vue'
import type { Ref } from 'vue'
import { useQueries, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import { GENERAL_PROJECT_PATH } from '@shared/ipc-contract'
import type { RecentProject, Session, SessionSummary } from '@shared/ipc-contract'

export function useSessionsListQuery(projects: Ref<RecentProject[]>) {
  const queryClient = useQueryClient()

  // Buckets to fan out over: every registered project plus the synthetic
  // General (no-project) bucket, so general chats show up in the home list
  // even though they're not backed by a registered project.
  const bucketPaths = computed(() => {
    const paths = projects.value.map((p) => p.path)
    if (!paths.includes(GENERAL_PROJECT_PATH)) paths.push(GENERAL_PROJECT_PATH)
    return paths
  })

  const persistedResults = useQueries({
    queries: computed(() =>
      bucketPaths.value.map((projectPath) => ({
        queryKey: queryKeys.sessions.persisted(projectPath),
        queryFn: (): Promise<Session[]> =>
          window.agentkeeper.sessions.listPersisted(projectPath).catch(() => []),
      })),
    ),
  })

  const historicalResults = useQueries({
    queries: computed(() =>
      bucketPaths.value.map((projectPath) => ({
        queryKey: queryKeys.sessions.historical(projectPath),
        queryFn: (): Promise<{ projectPath: string; summary: SessionSummary }[]> =>
          window.agentkeeper.sessions.list(projectPath)
            .then((items) => items.map((s) => ({ projectPath, summary: s })))
            .catch(() => []),
      })),
    ),
  })

  const trackedSdkIdResults = useQueries({
    queries: computed(() =>
      bucketPaths.value.map((projectPath) => ({
        queryKey: queryKeys.sessions.trackedSdkIds(projectPath),
        queryFn: (): Promise<string[]> =>
          window.agentkeeper.sessions.listTrackedSdkIds(projectPath).catch(() => []),
      })),
    ),
  })

  const trackedSdkIds = computed(() => {
    const all = trackedSdkIdResults.value.flatMap((r) => r.data ?? [])
    return new Set(all)
  })

  const persistedSessions = computed(() => {
    const all: Session[] = persistedResults.value.flatMap((r) => r.data ?? [])
    const seen = new Set<string>()
    return all.filter((s) => {
      if (seen.has(s.localId)) return false
      seen.add(s.localId)
      return true
    })
  })

  const historicalSessions = computed(() => {
    const all: { projectPath: string; summary: SessionSummary }[] = historicalResults.value.flatMap(
      (r) => r.data ?? [],
    )
    const seen = new Set<string>()
    return all
      .filter(({ summary: s }) => {
        if (seen.has(s.id)) return false
        seen.add(s.id)
        if (trackedSdkIds.value.has(s.id)) return false
        return true
      })
      .sort((a, b) => b.summary.lastActivityAt - a.summary.lastActivityAt)
  })

  const isLoading = computed(
    () =>
      persistedResults.value.some((r) => r.isLoading) ||
      historicalResults.value.some((r) => r.isLoading) ||
      trackedSdkIdResults.value.some((r) => r.isLoading),
  )

  function invalidateForProject(projectPath: string) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.persisted(projectPath) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.historical(projectPath) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.trackedSdkIds(projectPath) })
  }

  function invalidateAll() {
    for (const projectPath of bucketPaths.value) invalidateForProject(projectPath)
  }

  return {
    persistedSessions,
    historicalSessions,
    isLoading,
    invalidateForProject,
    invalidateAll,
  }
}
