import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentProject, Session, SessionSummary } from '@shared/ipc-contract'

export const useSessionsListStore = defineStore('sessionsList', () => {
  const persistedSessions = ref<Session[]>([])
  const historicalSessions = ref<{ projectPath: string; summary: SessionSummary }[]>([])
  const loading = ref(false)

  let _key = ''
  let _promise: Promise<void> | null = null

  async function _doLoad(projects: { path: string }[]): Promise<void> {
    loading.value = true
    try {
      const allPersisted: Session[] = []
      const allHistorical: { projectPath: string; summary: SessionSummary }[] = []

      await Promise.all(
        projects.map(async (p) => {
          try {
            const [sessions, historical] = await Promise.all([
              window.agentkeeper.sessions.listPersisted(p.path),
              window.agentkeeper.sessions.list(p.path),
            ])
            allPersisted.push(...sessions)
            allHistorical.push(...historical.map((s) => ({ projectPath: p.path, summary: s })))
          } catch {
            // non-fatal — missing project dir is normal for newly registered projects
          }
        }),
      )

      const seenPersisted = new Set<string>()
      persistedSessions.value = allPersisted.filter((s) => {
        if (seenPersisted.has(s.localId)) return false
        seenPersisted.add(s.localId)
        return true
      })

      const seenHistorical = new Set<string>()
      historicalSessions.value = allHistorical
        .filter(({ summary: s }) => {
          if (seenHistorical.has(s.id)) return false
          seenHistorical.add(s.id)
          return true
        })
        .sort((a, b) => b.summary.lastActivityAt - a.summary.lastActivityAt)
    } finally {
      loading.value = false
    }
  }

  function load(projects: RecentProject[]): Promise<void> {
    const key = projects.map((p) => p.path).sort().join('|')
    if (key === _key && _promise) return _promise
    _key = key
    _promise = _doLoad(projects)
    return _promise
  }

  function invalidate(): void {
    _key = ''
    _promise = null
  }

  function removePersisted(localId: string): void {
    persistedSessions.value = persistedSessions.value.filter((s) => s.localId !== localId)
  }

  function removeAgency(instanceId: string): void {
    persistedSessions.value = persistedSessions.value.filter(
      (s) => s.agencyInstanceId !== instanceId,
    )
  }

  function removeHistorical(projectPath: string, id: string): void {
    historicalSessions.value = historicalSessions.value.filter(
      ({ projectPath: pp, summary: s }) => !(pp === projectPath && s.id === id),
    )
  }

  return {
    persistedSessions,
    historicalSessions,
    loading,
    load,
    invalidate,
    removePersisted,
    removeAgency,
    removeHistorical,
  }
})
