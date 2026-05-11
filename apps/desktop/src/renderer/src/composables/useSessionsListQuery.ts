import { computed } from 'vue'
import type { Ref } from 'vue'
import { useQueries, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { RecentProject, Session, SessionSummary } from '@shared/ipc-contract'

export function useSessionsListQuery(projects: Ref<RecentProject[]>) {
  const queryClient = useQueryClient()

  const persistedResults = useQueries({
    queries: computed(() =>
      projects.value.map((p) => ({
        queryKey: queryKeys.sessions.persisted(p.path),
        queryFn: (): Promise<Session[]> =>
          window.agentkeeper.sessions.listPersisted(p.path).catch(() => []),
      })),
    ),
  })

  const historicalResults = useQueries({
    queries: computed(() =>
      projects.value.map((p) => ({
        queryKey: queryKeys.sessions.historical(p.path),
        queryFn: (): Promise<{ projectPath: string; summary: SessionSummary }[]> =>
          window.agentkeeper.sessions.list(p.path)
            .then((items) => items.map((s) => ({ projectPath: p.path, summary: s })))
            .catch(() => []),
      })),
    ),
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
        return true
      })
      .sort((a, b) => b.summary.lastActivityAt - a.summary.lastActivityAt)
  })

  const isLoading = computed(
    () =>
      persistedResults.value.some((r) => r.isLoading) ||
      historicalResults.value.some((r) => r.isLoading),
  )

  function invalidateForProject(projectPath: string) {
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.persisted(projectPath) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions.historical(projectPath) })
  }

  function invalidateAll() {
    for (const p of projects.value) invalidateForProject(p.path)
  }

  return {
    persistedSessions,
    historicalSessions,
    isLoading,
    invalidateForProject,
    invalidateAll,
  }
}
