<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/sessions'
import type { IssueTransition, WorkItem, WorkItemStatus } from '@shared/ipc-contract'

const props = defineProps<{
  id: string
  projectPath: string
}>()

const emit = defineEmits<{
  back: []
  sessionStarted: [localId: string]
}>()

const sessionStore = useSessionStore()
const item = ref<WorkItem | null>(null)
const loading = ref(true)
const startError = ref<string | null>(null)
const statusUpdating = ref<string | null>(null)
const statusError = ref<string | null>(null)
const availableTransitions = ref<IssueTransition[]>([])
const transitionsLoading = ref(false)

const fallbackStatuses: WorkItemStatus[] = ['backlog', 'open', 'in_progress', 'in_review', 'done', 'closed']

const statusLabel: Record<WorkItemStatus, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

const statusClass: Record<WorkItemStatus, string> = {
  backlog: 'bg-slate-500/15 text-slate-400',
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  closed: 'bg-muted text-muted-foreground',
}

async function loadTransitions(id: string) {
  transitionsLoading.value = true
  try {
    availableTransitions.value = await window.orchestral.workItems.getTransitions(id)
  } catch {
    availableTransitions.value = []
  } finally {
    transitionsLoading.value = false
  }
}

onMounted(async () => {
  try {
    item.value = (await window.orchestral.workItems.get(props.id)) ?? null
    if (item.value) await loadTransitions(item.value.id)
  } finally {
    loading.value = false
  }
})

interface IssueTypeBadge { icon: string; cls: string }

function issueTypeBadge(type: string | undefined): IssueTypeBadge | null {
  if (!type) return null
  switch (type.toLowerCase()) {
    case 'epic':     return { icon: '⚡', cls: 'bg-purple-500/20 text-purple-400' }
    case 'story':    return { icon: '📋', cls: 'bg-blue-500/20 text-blue-400' }
    case 'task':     return { icon: '✓', cls: 'bg-blue-500/20 text-blue-400' }
    case 'bug':
    case 'defect':   return { icon: '●', cls: 'bg-red-500/20 text-red-400' }
    case 'sub-task':
    case 'subtask':  return { icon: '↳', cls: 'bg-muted text-muted-foreground' }
    case 'feature':  return { icon: '★', cls: 'bg-teal-500/20 text-teal-400' }
    default:         return { icon: '', cls: 'bg-muted text-muted-foreground' }
  }
}

async function applyTransition(transitionName: string) {
  if (!item.value) return
  statusError.value = null
  statusUpdating.value = transitionName
  try {
    await window.orchestral.workItems.transition(item.value.id, transitionName)
    const refreshed = await window.orchestral.workItems.get(item.value.id)
    if (refreshed) {
      item.value = refreshed
      await loadTransitions(item.value.id)
    }
  } catch (err) {
    statusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    statusUpdating.value = null
  }
}

async function setStatus(newStatus: WorkItemStatus) {
  if (!item.value || newStatus === item.value.status) return
  statusError.value = null
  statusUpdating.value = newStatus
  try {
    await window.orchestral.workItems.updateStatus(item.value.id, newStatus)
    const refreshed = await window.orchestral.workItems.get(item.value.id)
    if (refreshed) {
      item.value = refreshed
      await loadTransitions(item.value.id)
    }
  } catch (err) {
    statusError.value = err instanceof Error ? err.message : String(err)
  } finally {
    statusUpdating.value = null
  }
}

async function startSession() {
  if (!item.value) return
  startError.value = null
  try {
    const localId = await sessionStore.start({
      projectPath: props.projectPath,
      initialPrompt: '',
      workItemId: item.value.id,
    })
    emit('sessionStarted', localId)
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
      <Button variant="ghost" size="sm" @click="emit('back')">← Back</Button>
      <span class="text-sm font-medium text-muted-foreground">Issue detail</span>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      Loading…
    </div>

    <div v-else-if="!item" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      Issue not found.
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-muted-foreground mb-1">{{ item.externalRef }}</div>
          <h2 class="text-sm font-semibold leading-snug">{{ item.title }}</h2>
        </div>
        <div class="shrink-0 flex items-center gap-1.5">
          <template v-if="item.issueType">
            <span
              class="text-xs px-2 py-0.5 rounded-full"
              :class="issueTypeBadge(item.issueType)?.cls ?? 'bg-muted text-muted-foreground'"
            >
              <template v-if="issueTypeBadge(item.issueType)?.icon">{{ issueTypeBadge(item.issueType)!.icon }} </template>{{ item.issueType }}
            </span>
          </template>
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :class="statusClass[item.status] ?? 'bg-muted text-muted-foreground'"
          >
            {{ statusLabel[item.status] ?? item.status }}
          </span>
        </div>
      </div>

      <!-- Status pills -->
      <div class="space-y-1">
        <div class="text-xs text-muted-foreground">Update status</div>
        <div v-if="transitionsLoading" class="text-xs text-muted-foreground">Loading transitions…</div>
        <div v-else class="flex flex-wrap gap-1.5">
          <template v-if="availableTransitions.length > 0">
            <button
              v-for="t in availableTransitions"
              :key="t.name"
              class="text-xs px-2.5 py-1 rounded-full border border-transparent bg-muted/40 text-foreground/80 transition-opacity hover:opacity-90"
              :class="statusUpdating === t.name ? 'opacity-40 cursor-wait' : ''"
              :disabled="statusUpdating !== null"
              @click="applyTransition(t.name)"
            >
              {{ statusUpdating === t.name ? '…' : t.toStatusLabel }}
            </button>
          </template>
          <template v-else>
            <button
              v-for="s in fallbackStatuses"
              :key="s"
              class="text-xs px-2.5 py-1 rounded-full border transition-opacity"
              :class="[
                statusClass[s],
                s === item.status ? 'border-current opacity-100 ring-1 ring-current' : 'border-transparent opacity-60 hover:opacity-90',
                statusUpdating === s ? 'opacity-40 cursor-wait' : '',
              ]"
              :disabled="statusUpdating !== null"
              @click="setStatus(s)"
            >
              {{ statusUpdating === s ? '…' : statusLabel[s] }}
            </button>
          </template>
        </div>
        <div v-if="statusError" class="text-xs text-destructive">{{ statusError }}</div>
      </div>

      <div v-if="item.assignee" class="text-xs text-muted-foreground">
        Assignee: {{ item.assignee }}
      </div>

      <div v-if="item.body" class="text-xs text-foreground/80 whitespace-pre-wrap font-mono bg-muted/30 rounded p-3">
        {{ item.body }}
      </div>

      <div v-if="startError" class="text-xs text-destructive bg-destructive/5 rounded p-2">
        {{ startError }}
      </div>

      <Button size="sm" @click="startSession">Start session from this issue</Button>
    </div>
  </div>
</template>
