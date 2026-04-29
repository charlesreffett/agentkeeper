<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePluginHealth } from '@/composables/usePluginHealth'
import JiraCreateTicketModal from './JiraCreateTicketModal.vue'
import type { WorkItem, WorkItemStatus } from '@shared/ipc-contract'

const router = useRouter()
const { isHealthy } = usePluginHealth('jira')

const allItems = ref<WorkItem[]>([])
const loading = ref(false)
const search = ref('')
const boardFilter = ref('')
const createOpen = ref(false)

const statusOrder: WorkItemStatus[] = ['backlog', 'open', 'in_progress', 'in_review', 'done', 'closed']

const statusLabel: Record<WorkItemStatus, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

const statusHeaderClass: Record<WorkItemStatus, string> = {
  backlog: 'text-slate-400',
  open: 'text-blue-400',
  in_progress: 'text-yellow-400',
  in_review: 'text-purple-400',
  done: 'text-green-400',
  closed: 'text-muted-foreground',
}

const statusBadgeClass: Record<WorkItemStatus, string> = {
  backlog: 'bg-slate-500/15 text-slate-400',
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  closed: 'bg-muted text-muted-foreground',
}

const priorityClass: Record<string, string> = {
  critical: 'text-red-500',
  highest: 'text-red-500',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  lowest: 'text-muted-foreground',
}

interface IssueTypeBadge { icon: string; cls: string }

function issueTypeBadge(type: string | undefined): IssueTypeBadge | null {
  if (!type) return null
  switch (type.toLowerCase()) {
    case 'epic':    return { icon: '⚡', cls: 'bg-purple-500/20 text-purple-400' }
    case 'story':   return { icon: '📋', cls: 'bg-blue-500/20 text-blue-400' }
    case 'task':    return { icon: '✓', cls: 'bg-blue-500/20 text-blue-400' }
    case 'bug':
    case 'defect':  return { icon: '●', cls: 'bg-red-500/20 text-red-400' }
    case 'sub-task':
    case 'subtask': return { icon: '↳', cls: 'bg-muted text-muted-foreground' }
    case 'feature': return { icon: '★', cls: 'bg-teal-500/20 text-teal-400' }
    default:        return { icon: '', cls: 'bg-muted text-muted-foreground' }
  }
}

function projectKey(ref: string): string {
  return ref.match(/^[A-Z]+/)?.[0] ?? ''
}

const boards = computed<string[]>(() => {
  const keys = new Set<string>()
  for (const item of allItems.value) {
    const k = projectKey(item.externalRef)
    if (k) keys.add(k)
  }
  return Array.from(keys).sort()
})

const filteredItems = computed(() => {
  let items = allItems.value
  if (boardFilter.value) {
    items = items.filter((i) => projectKey(i.externalRef) === boardFilter.value)
  }
  const q = search.value.trim().toLowerCase()
  if (q) {
    items = items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.externalRef.toLowerCase().includes(q),
    )
  }
  return items
})

const columns = computed(() => {
  const grouped = new Map<WorkItemStatus, WorkItem[]>()
  for (const s of statusOrder) grouped.set(s, [])
  for (const item of filteredItems.value) {
    grouped.get(item.status)?.push(item)
  }
  // omit Closed unless it has items
  const result: Array<{ status: WorkItemStatus; items: WorkItem[] }> = []
  for (const s of statusOrder) {
    const items = grouped.get(s) ?? []
    if (s === 'closed' && items.length === 0) continue
    result.push({ status: s, items })
  }
  return result
})

function assigneeInitials(name: string | undefined): string {
  if (!name) return ''
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

async function load() {
  loading.value = true
  try {
    const all = await window.agentkeeper.workItems.list()
    allItems.value = all.filter((i) => i.source === 'jira')
  } catch {
    // cliMissing handled by health composable
  } finally {
    loading.value = false
  }
}

function onCreated(item: WorkItem) {
  allItems.value.push(item)
}

let unsub: (() => void) | null = null
onMounted(() => {
  void load()
  unsub = window.agentkeeper.plugins.onEvent((event) => {
    if (event === 'plugin.healthy') void load()
  })
})
onUnmounted(() => unsub?.())
</script>

<template>
  <div class="h-full flex min-h-0">
    <!-- Left sidebar: boards -->
    <aside class="w-40 shrink-0 border-r border-border flex flex-col overflow-y-auto bg-card/20">
      <div class="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Boards
      </div>
      <button
        class="text-left px-3 py-1.5 text-sm rounded-sm mx-1 transition-colors"
        :class="boardFilter === '' ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted/40'"
        @click="boardFilter = ''"
      >
        All
      </button>
      <button
        v-for="key in boards"
        :key="key"
        class="text-left px-3 py-1.5 text-sm font-mono rounded-sm mx-1 transition-colors"
        :class="boardFilter === key ? 'bg-primary/10 text-primary font-medium' : 'text-foreground hover:bg-muted/40'"
        @click="boardFilter = key"
      >
        {{ key }}
      </button>
    </aside>

    <!-- Main board area -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- Top bar -->
      <div class="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border">
        <input
          v-model="search"
          type="text"
          placeholder="Search issues…"
          class="flex-1 text-sm bg-background border border-input rounded px-3 py-1 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          class="shrink-0 text-sm px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          :disabled="!isHealthy"
          @click="createOpen = true"
        >
          + Create ticket
        </button>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>

      <!-- Swimlane board -->
      <div v-else class="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div class="flex h-full gap-0">
          <div
            v-for="col in columns"
            :key="col.status"
            class="flex flex-col min-w-[220px] w-[220px] border-r border-border/50 last:border-r-0"
          >
            <!-- Column header -->
            <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/50">
              <span class="text-xs font-semibold uppercase tracking-wide" :class="statusHeaderClass[col.status]">
                {{ statusLabel[col.status] }}
              </span>
              <span class="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                {{ col.items.length }}
              </span>
            </div>
            <!-- Cards -->
            <div class="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              <div
                v-if="col.items.length === 0"
                class="text-xs text-muted-foreground/50 text-center py-4"
              >
                No issues
              </div>
              <div
                v-for="item in col.items"
                :key="item.id"
                class="rounded-md border border-border bg-card p-2.5 cursor-pointer hover:bg-muted/30 transition-colors space-y-1.5"
                @click="router.push(`/jira/issue/${item.id}`)"
              >
                <div class="text-xs font-mono text-muted-foreground">{{ item.externalRef }}</div>
                <div class="text-xs leading-snug line-clamp-2">{{ item.title }}</div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span
                    v-if="item.issueType && issueTypeBadge(item.issueType)"
                    class="text-xs px-1.5 py-0.5 rounded-full"
                    :class="issueTypeBadge(item.issueType)!.cls"
                  >
                    <template v-if="issueTypeBadge(item.issueType)!.icon">{{ issueTypeBadge(item.issueType)!.icon }} </template>{{ item.issueType }}
                  </span>
                  <span
                    v-if="item.priority"
                    class="text-xs font-medium"
                    :class="priorityClass[item.priority.toLowerCase()] ?? 'text-muted-foreground'"
                  >
                    ● {{ item.priority }}
                  </span>
                </div>
                <div v-if="item.assignee" class="text-right">
                  <span class="inline-flex items-center justify-center text-xs w-5 h-5 rounded-full bg-muted text-muted-foreground font-mono font-medium">
                    {{ assigneeInitials(item.assignee) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <JiraCreateTicketModal
    :open="createOpen"
    @close="createOpen = false"
    @created="onCreated"
  />
</template>
