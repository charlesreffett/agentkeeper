import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ActivityActor = 'user' | 'claude' | 'system'

export interface ActivityEntry {
  id: string
  workItemId: string
  actor: ActivityActor
  message: string
  timestamp: number
}

export const useJiraActivityStore = defineStore('jiraActivity', () => {
  const entries = ref<ActivityEntry[]>([])

  function addEntry(workItemId: string, actor: ActivityActor, message: string) {
    entries.value.unshift({
      id: crypto.randomUUID(),
      workItemId,
      actor,
      message,
      timestamp: Date.now(),
    })
  }

  function getEntries(workItemId: string): ActivityEntry[] {
    return entries.value.filter((e) => e.workItemId === workItemId)
  }

  return { entries, addEntry, getEntries }
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
