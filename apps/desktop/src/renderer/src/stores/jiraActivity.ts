import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { JiraActivityEntry } from '@shared/ipc-contract'

export type ActivityActor = 'user' | 'claude' | 'system'
export type ActivityEntry = JiraActivityEntry

export const useJiraActivityStore = defineStore('jiraActivity', () => {
  const cache = ref<Map<string, JiraActivityEntry[]>>(new Map())
  const loaded = ref<Set<string>>(new Set())

  async function ensureLoaded(ticketRef: string) {
    if (loaded.value.has(ticketRef)) return
    const entries = await window.agentkeeper.jira.activityList(ticketRef)
    cache.value.set(ticketRef, entries)
    loaded.value.add(ticketRef)
  }

  async function addEntry(ticketRef: string, actor: ActivityActor, message: string) {
    const entry = await window.agentkeeper.jira.activityAdd({ ticketRef, actor, message })
    const current = cache.value.get(ticketRef) ?? []
    cache.value.set(ticketRef, [entry, ...current])
    if (!loaded.value.has(ticketRef)) loaded.value.add(ticketRef)
  }

  async function getEntries(ticketRef: string): Promise<JiraActivityEntry[]> {
    await ensureLoaded(ticketRef)
    return cache.value.get(ticketRef) ?? []
  }

  return { addEntry, getEntries }
})

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
