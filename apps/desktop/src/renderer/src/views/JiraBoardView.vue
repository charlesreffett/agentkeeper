<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue'
import type { Ref } from 'vue'
import { useRouter } from 'vue-router'
import { Bot, ChevronDown, ChevronRight, Plus, Settings, SlidersHorizontal } from '@/components/icons/app-icons'
import { usePluginHealth } from '@/composables/usePluginHealth'
import { useSessionStore } from '@/stores/sessions'
import { Input } from '@/components/ui/input'
import JiraCreateTicketModal from './JiraCreateTicketModal.vue'
import type { WorkItem, WorkItemStatus } from '@shared/ipc-contract'

const router = useRouter()
const { isHealthy } = usePluginHealth('jira')
const sessionStore = useSessionStore()

// ─── Types ────────────────────────────────────────────────────────────────────

type ScopeFilter = 'all' | 'assigned' | 'has_session' | 'urgent_high'
type GroupByKey = 'flat' | 'status' | 'priority' | 'board' | 'epic' | 'assignee'

interface Group {
  key: string
  label: string
  items: WorkItem[]
  pts: number
}

interface ScopeOption {
  key: ScopeFilter
  label: string
}

interface GroupOption {
  key: GroupByKey
  label: string
}

// ─── State ────────────────────────────────────────────────────────────────────

const allItems = ref<WorkItem[]>([])
const loading = ref(false)
const searchQuery = ref('')
const groupBy = ref<GroupByKey>('flat')
const scopeFilter = ref<ScopeFilter>('all')
const selectedBoards = ref(new Set<string>())
const collapsedGroups = ref(new Set<string>(['done', 'closed']))
const createOpen = ref(false)

const SCOPE_OPTIONS: ScopeOption[] = [
  { key: 'all', label: 'All issues' },
  { key: 'assigned', label: 'Assigned to me' },
  { key: 'has_session', label: 'Has session' },
  { key: 'urgent_high', label: 'Urgent & high' },
]

const GROUP_OPTIONS: GroupOption[] = [
  { key: 'flat', label: 'Flat' },
  { key: 'status', label: 'Status' },
  { key: 'priority', label: 'Priority' },
  { key: 'board', label: 'Board' },
  { key: 'epic', label: 'Epic' },
  { key: 'assignee', label: 'Assignee' },
]

// ─── Session linkage ──────────────────────────────────────────────────────────

const activeKeys = computed(() => {
  const s = new Set<string>()
  for (const sess of Object.values(sessionStore.sessions)) {
    if (sess.workItemKey && ['starting', 'running', 'blocked'].includes(sess.status)) {
      s.add(sess.workItemKey)
    }
  }
  return s
})

function hasSession(item: WorkItem): boolean {
  return activeKeys.value.has(item.externalRef)
}

// ─── Board key prefix ─────────────────────────────────────────────────────────

function boardOf(item: WorkItem): string {
  return item.externalRef.match(/^[A-Z]+/)?.[0] ?? ''
}

const BOARD_PALETTE = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-emerald-600',
  'bg-orange-500', 'bg-red-500', 'bg-cyan-500', 'bg-amber-500',
]

const colorMap = computed(() => {
  const keys = [...new Set(allItems.value.map(boardOf).filter(Boolean))].sort()
  return new Map(keys.map((k, i) => [k, BOARD_PALETTE[i % BOARD_PALETTE.length]!]))
})

// ─── Issue type badge ─────────────────────────────────────────────────────────

function typeBadge(type?: string): { letter: string; cls: string } {
  switch ((type ?? '').toLowerCase()) {
    case 'epic':    return { letter: 'E', cls: 'bg-purple-500 text-white' }
    case 'story':   return { letter: 'S', cls: 'bg-teal-500 text-white' }
    case 'bug':
    case 'defect':  return { letter: 'B', cls: 'bg-red-500 text-white' }
    default:        return { letter: 'T', cls: 'bg-blue-500 text-white' }
  }
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function priorityBadge(p?: string): { text: string; cls: string } {
  switch ((p ?? '').toLowerCase()) {
    case 'highest':
    case 'critical': return { text: (p ?? '').toLowerCase(), cls: 'bg-red-500/15 text-red-400 border border-red-500/30' }
    case 'urgent':   return { text: 'urgent', cls: 'bg-orange-500/15 text-orange-400 border border-orange-500/30' }
    case 'high':     return { text: 'high',   cls: 'bg-yellow-500/15 text-yellow-500 border border-yellow-500/30' }
    case 'medium':   return { text: 'med',    cls: 'bg-muted text-muted-foreground border border-border' }
    case 'low':      return { text: 'low',    cls: 'bg-muted text-muted-foreground border border-border' }
    default:         return { text: p ? p.toLowerCase() : '–', cls: 'bg-muted text-muted-foreground border border-border' }
  }
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_ORDER: WorkItemStatus[] = ['in_progress', 'in_review', 'open', 'backlog', 'done', 'closed']

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  closed: 'Closed',
}

function rowSubtitle(item: WorkItem): string {
  const s = item.statusLabel ?? STATUS_LABEL[item.status] ?? item.status
  return item.parentRef ? `${s} · ${item.parentRef}` : s
}

function isDone(item: WorkItem): boolean {
  return item.status === 'done' || item.status === 'closed'
}

// ─── Sidebar boards ───────────────────────────────────────────────────────────

const jiraItems = computed(() => allItems.value.filter((i) => i.source === 'jira'))

const configuredBoards = ref<Array<{ jiraProjectKey: string; projectPath: string }>>([])

// True per-board totals from Jira REST (approximate-count). Keyed by board prefix.
// Empty when auth unavailable — sidebar falls back to loaded/capped counts.
const restCounts = ref<Record<string, number>>({})

async function loadConfiguredBoards() {
  try {
    const cfg = (await window.agentkeeper.plugins.getConfig('jira')) as {
      projectMappings?: Array<{ jiraProjectKey: string; projectPath: string }>
    } | null
    configuredBoards.value = cfg?.projectMappings ?? []
  } catch {
    configuredBoards.value = []
  }
}

// Loaded-data counts by board prefix (capped at the paginated fetch limit)
const loadedCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of jiraItems.value) {
    const k = boardOf(item)
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return counts
})

// Canonical board key list: configured mappings first, then auto-discovered.
const boardKeys = computed(() => {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const { jiraProjectKey: key } of configuredBoards.value) {
    if (key && !seen.has(key)) { seen.add(key); keys.push(key) }
  }
  for (const key of loadedCounts.value.keys()) {
    if (!seen.has(key)) { seen.add(key); keys.push(key) }
  }
  return keys.sort((a, b) => a.localeCompare(b))
})

async function loadCounts() {
  const keys = boardKeys.value
  if (keys.length === 0) return
  try {
    restCounts.value = await window.agentkeeper.workItems.counts(keys)
  } catch {
    restCounts.value = {}
  }
}

const allBoards = computed(() =>
  boardKeys.value.map((key) => ({
    key,
    count: restCounts.value[key] ?? loadedCounts.value.get(key) ?? 0,
  })),
)

function toggleBoard(k: string) {
  const n = new Set(selectedBoards.value)
  n.has(k) ? n.delete(k) : n.add(k)
  selectedBoards.value = n
}

// ─── Filtering ────────────────────────────────────────────────────────────────

const isUrgentHigh = (item: WorkItem) =>
  ['highest', 'high', 'urgent', 'critical'].includes((item.priority ?? '').toLowerCase())

const filtered = computed(() => {
  let items = jiraItems.value

  const q = searchQuery.value.trim().toLowerCase()
  if (q) items = items.filter((i) => i.title.toLowerCase().includes(q) || i.externalRef.toLowerCase().includes(q))

  if (scopeFilter.value === 'assigned')    items = items.filter((i) => !!i.assignee)
  if (scopeFilter.value === 'has_session') items = items.filter(hasSession)
  if (scopeFilter.value === 'urgent_high') items = items.filter(isUrgentHigh)

  if (selectedBoards.value.size > 0) items = items.filter((i) => selectedBoards.value.has(boardOf(i)))

  // Always sort by status order so flat list flows in a meaningful sequence
  return [...items].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status)
    const bi = STATUS_ORDER.indexOf(b.status)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
})

// ─── Scope counts (always against full jiraItems, not filtered) ───────────────

const scopeCounts = computed<Record<ScopeFilter, number>>(() => ({
  all:          jiraItems.value.length,
  assigned:     jiraItems.value.filter((i) => !!i.assignee).length,
  has_session:  jiraItems.value.filter(hasSession).length,
  urgent_high:  jiraItems.value.filter(isUrgentHigh).length,
}))

// ─── Stats row ────────────────────────────────────────────────────────────────

const activeCount = computed(() => filtered.value.filter(hasSession).length)
const totalPts    = computed(() => filtered.value.reduce((s, i) => s + (i.storyPoints ?? 0), 0))

// ─── Grouping ─────────────────────────────────────────────────────────────────

const groups = computed<Group[]>(() => {
  const items = filtered.value

  if (groupBy.value === 'flat') {
    return [{ key: '__flat', label: '', items, pts: totalPts.value }]
  }

  const map = new Map<string, WorkItem[]>()
  for (const item of items) {
    let k: string
    switch (groupBy.value) {
      case 'status':   k = item.status; break
      case 'priority': k = (item.priority ?? 'none').toLowerCase(); break
      case 'board':    k = boardOf(item) || 'Other'; break
      case 'epic':     k = item.parentRef ?? 'No Epic'; break
      case 'assignee': k = item.assignee ?? 'Unassigned'; break
      default:         k = 'All'
    }
    if (!map.has(k)) map.set(k, [])
    map.get(k)!.push(item)
  }

  let entries = [...map.entries()]

  if (groupBy.value === 'status') {
    entries.sort(([a], [b]) => {
      const ai = STATUS_ORDER.indexOf(a as WorkItemStatus)
      const bi = STATUS_ORDER.indexOf(b as WorkItemStatus)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  } else if (groupBy.value === 'priority') {
    const po = ['highest', 'critical', 'urgent', 'high', 'medium', 'low', 'lowest', 'none']
    entries.sort(([a], [b]) => {
      const ai = po.indexOf(a); const bi = po.indexOf(b)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  } else {
    entries.sort(([a], [b]) => a.localeCompare(b))
  }

  return entries.map(([key, grpItems]) => ({
    key,
    label: groupBy.value === 'status' ? (STATUS_LABEL[key] ?? key) : key,
    items: grpItems,
    pts: grpItems.reduce((s, i) => s + (i.storyPoints ?? 0), 0),
  }))
})

function toggleGroup(key: string) {
  const n = new Set(collapsedGroups.value)
  n.has(key) ? n.delete(key) : n.add(key)
  collapsedGroups.value = n
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name?: string): string {
  return (name ?? '?').split(' ').map((w) => w[0] ?? '').slice(0, 2).join('').toUpperCase()
}

// ─── Data loading ─────────────────────────────────────────────────────────────

async function load() {
  loading.value = true
  try {
    allItems.value = await window.agentkeeper.workItems.list()
  } catch {
    // health composable surfaces the error in JiraLayout
  } finally {
    loading.value = false
  }
}

const jiraConfigVersion = inject<Ref<number>>('jiraConfigVersion', ref(0))
watch(jiraConfigVersion, () => { void loadConfiguredBoards() })
watch(boardKeys, () => { void loadCounts() }, { immediate: true })

let unsub: (() => void) | null = null
onMounted(() => {
  void load()
  void loadConfiguredBoards()
  unsub = window.agentkeeper.plugins.onEvent((ev) => {
    if (ev === 'plugin.healthy') {
      void load()
      void loadConfiguredBoards()
    }
  })
})
onUnmounted(() => unsub?.())
</script>

<template>
  <div class="h-full flex min-h-0">

    <!-- ─── Left sidebar ──────────────────────────────────────────────────── -->
    <aside class="w-56 shrink-0 border-r border-border flex flex-col bg-background overflow-hidden">

      <!-- Header -->
      <div class="flex items-center justify-between px-3 pt-3 pb-1.5 shrink-0">
        <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Filters
        </span>
        <div class="flex items-center gap-1">
          <button
            class="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            title="Jira settings"
            @click="void router.push('/settings/jira')"
          >
            <Settings :size="12" />
          </button>
          <button
            class="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
            title="Add filter"
          >
            <Plus :size="11" />
          </button>
        </div>
      </div>

      <!-- SCOPE -->
      <div class="px-2 pb-1 shrink-0">
        <div class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-0.5">
          Scope
        </div>
        <button
          v-for="opt in SCOPE_OPTIONS"
          :key="opt.key"
          class="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors"
          :class="scopeFilter === opt.key
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-foreground hover:bg-muted/40'"
          @click="scopeFilter = opt.key"
        >
          <span class="flex items-center gap-2">
            <!-- scope icons -->
            <span class="text-muted-foreground w-3 text-center leading-none shrink-0">
              <template v-if="opt.key === 'all'">≡</template>
              <template v-else-if="opt.key === 'assigned'">◎</template>
              <template v-else-if="opt.key === 'has_session'">
                <Bot :size="11" class="inline" />
              </template>
              <template v-else>⚡</template>
            </span>
            {{ opt.label }}
          </span>
          <span class="tabular-nums text-[10px]"
            :class="scopeFilter === opt.key ? 'text-primary/70' : 'text-muted-foreground'">
            {{ scopeCounts[opt.key] }}
          </span>
        </button>
      </div>

      <div class="mx-3 border-t border-border/50 my-1 shrink-0" />

      <!-- BOARDS -->
      <div class="px-2 pb-2 flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div class="flex items-center justify-between px-1 mb-1 shrink-0">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Boards
          </span>
          <span class="text-[10px] text-muted-foreground">
            {{ selectedBoards.size === 0 ? 'none' : `${selectedBoards.size} on` }}
          </span>
        </div>
        <button
          v-for="board in allBoards"
          :key="board.key"
          class="w-full flex items-center justify-between px-2 py-1.5 rounded text-xs transition-colors hover:bg-muted/40"
          @click="toggleBoard(board.key)"
        >
          <span class="flex items-center gap-2">
            <!-- Checkbox -->
            <span
              class="w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 transition-colors"
              :class="selectedBoards.has(board.key)
                ? `${colorMap.get(board.key)} border-transparent`
                : 'border-border'"
            >
              <svg v-if="selectedBoards.has(board.key)" viewBox="0 0 8 6" class="w-2 h-1.5">
                <path d="M1 3l2 2 4-4" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <!-- Color dot -->
            <span
              class="inline-block w-2 h-2 rounded-full shrink-0"
              :class="colorMap.get(board.key) ?? 'bg-muted'"
            />
            <span class="font-mono text-foreground">{{ board.key }}</span>
          </span>
          <span class="tabular-nums text-[10px] text-muted-foreground">{{ board.count }}</span>
        </button>
      </div>
    </aside>

    <!-- ─── Main content ───────────────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 flex flex-col">

      <!-- Header: count context + search/actions -->
      <div class="shrink-0 px-6 pt-4 flex items-end justify-between">
        <div>
          <div class="text-[10px] font-medium tracking-widest text-muted-foreground uppercase mb-1">
            <template v-if="filtered.length === jiraItems.length">
              {{ jiraItems.length }} issue{{ jiraItems.length !== 1 ? 's' : '' }}
            </template>
            <template v-else>
              {{ filtered.length }} of {{ jiraItems.length }} issues
            </template>
          </div>
          <h1 class="text-xl font-bold text-foreground leading-tight">Issues</h1>
        </div>
        <div class="flex items-center gap-2 pb-0.5">
          <!-- Search -->
          <div class="relative">
            <svg
              class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10"
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2.5"
            >
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <Input
              v-model="searchQuery"
              type="text"
              placeholder="Search issues"
              class="w-44 pl-7 h-7 text-xs"
            />
          </div>
          <!-- Filter -->
          <button
            class="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-input rounded-md bg-background hover:bg-muted/50 transition-colors text-foreground"
          >
            <SlidersHorizontal :size="11" />
            Filter
          </button>
          <!-- New -->
          <button
            class="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="!isHealthy"
            @click="createOpen = true"
          >
            <Plus :size="11" />
            New
          </button>
        </div>
      </div>

      <!-- GROUP BY pills + stats -->
      <div class="shrink-0 flex items-center justify-between px-6 py-2 mt-2 border-b border-border">
        <div class="flex items-center gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shrink-0">
            Group by
          </span>
          <div class="flex items-center gap-0.5">
            <button
              v-for="opt in GROUP_OPTIONS"
              :key="opt.key"
              class="px-2.5 py-0.5 text-xs rounded-full transition-colors"
              :class="groupBy === opt.key
                ? 'bg-foreground text-background font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'"
              @click="groupBy = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>
        </div>
        <span class="text-xs text-muted-foreground tabular-nums shrink-0">
          {{ activeCount }} active · {{ totalPts }} pts
        </span>
      </div>

      <!-- Column headers -->
      <div
        class="shrink-0 flex items-center px-4 py-1.5 border-b border-border/50
               text-[10px] font-semibold uppercase tracking-wider text-muted-foreground select-none"
      >
        <div class="w-[52px] shrink-0" />
        <div class="w-[88px] shrink-0">Key</div>
        <div class="flex-1 min-w-0">Title</div>
        <div class="w-[100px] shrink-0">Board</div>
        <div class="w-[80px] shrink-0">Priority</div>
        <div class="w-[52px] shrink-0 text-right">Points</div>
        <div class="w-[80px] shrink-0 text-right">Comments</div>
        <div class="w-[72px] shrink-0 pl-1">Assignee</div>
        <div class="w-[88px] shrink-0 text-right">Updated</div>
      </div>

      <!-- Issue list -->
      <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>

      <div v-else class="flex-1 min-h-0 overflow-y-auto">

        <template v-for="group in groups" :key="group.key">

          <!-- Group header (hidden in flat mode) -->
          <div
            v-if="groupBy !== 'flat'"
            class="flex items-center gap-2 px-4 py-1.5 bg-muted/20 border-b border-border/40
                   cursor-pointer select-none hover:bg-muted/30 transition-colors"
            :class="group.items.some(hasSession)
              ? 'border-l-[3px] border-l-green-500'
              : 'border-l-[3px] border-l-transparent'"
            @click="toggleGroup(group.key)"
          >
            <component
              :is="collapsedGroups.has(group.key) ? ChevronRight : ChevronDown"
              :size="12"
              class="text-muted-foreground shrink-0"
            />
            <span class="text-xs font-semibold text-foreground">{{ group.label }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">
              {{ group.items.length }}
            </span>
            <span class="ml-auto text-[10px] text-muted-foreground tabular-nums">
              {{ group.pts > 0 ? `${group.pts} pts` : '' }}
            </span>
          </div>

          <!-- Issue rows -->
          <template v-if="!collapsedGroups.has(group.key)">
            <div
              v-for="item in group.items"
              :key="item.id"
              class="flex items-center px-4 py-2 border-b border-border/30 cursor-pointer
                     hover:bg-muted/20 transition-colors"
              :class="hasSession(item)
                ? 'border-l-[3px] border-l-green-500'
                : 'border-l-[3px] border-l-transparent'"
              @click="router.push(`/jira/issue/${item.id}`)"
            >
              <!-- Session indicator + type badge -->
              <div class="w-[52px] shrink-0 flex items-center gap-1.5">
                <Bot
                  v-if="hasSession(item)"
                  :size="13"
                  class="text-green-500 shrink-0"
                />
                <div v-else class="w-[13px] shrink-0" />
                <span
                  class="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold shrink-0"
                  :class="typeBadge(item.issueType).cls"
                >
                  {{ typeBadge(item.issueType).letter }}
                </span>
              </div>

              <!-- Key -->
              <div class="w-[88px] shrink-0 font-mono text-xs text-muted-foreground truncate">
                {{ item.externalRef }}
              </div>

              <!-- Title + subtitle -->
              <div class="flex-1 min-w-0 pr-4">
                <div
                  class="text-sm font-medium text-foreground truncate leading-snug"
                  :class="isDone(item) ? 'line-through text-muted-foreground' : ''"
                >
                  {{ item.title }}
                </div>
                <div class="text-[11px] text-muted-foreground truncate mt-0.5">
                  {{ rowSubtitle(item) }}
                </div>
              </div>

              <!-- Board -->
              <div class="w-[100px] shrink-0 flex items-center gap-1.5 pr-2">
                <span
                  class="inline-block w-2 h-2 rounded-full shrink-0"
                  :class="colorMap.get(boardOf(item)) ?? 'bg-muted'"
                />
                <span class="text-xs text-foreground font-mono truncate">{{ boardOf(item) }}</span>
              </div>

              <!-- Priority -->
              <div class="w-[80px] shrink-0">
                <span
                  v-if="item.priority"
                  class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                  :class="priorityBadge(item.priority).cls"
                >
                  {{ priorityBadge(item.priority).text }}
                </span>
                <span v-else class="text-xs text-muted-foreground">–</span>
              </div>

              <!-- Points -->
              <div class="w-[52px] shrink-0 text-right text-xs text-foreground tabular-nums">
                {{ item.storyPoints ?? '–' }}
              </div>

              <!-- Comments (not in WorkItem; always –) -->
              <div class="w-[80px] shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                –
              </div>

              <!-- Assignee -->
              <div class="w-[72px] shrink-0 pl-1 flex items-center">
                <span
                  v-if="item.assignee"
                  class="inline-flex items-center justify-center w-6 h-6 rounded-full
                         bg-blue-500/20 text-blue-400 text-[10px] font-bold shrink-0"
                  :title="item.assignee"
                >
                  {{ initials(item.assignee) }}
                </span>
                <span v-else class="text-xs text-muted-foreground">–</span>
              </div>

              <!-- Updated: "live" when a session is working it, otherwise – -->
              <div class="w-[88px] shrink-0 text-right text-xs">
                <span v-if="hasSession(item)" class="text-green-500 font-medium">live</span>
                <span v-else class="text-muted-foreground">–</span>
              </div>
            </div>
          </template>
        </template>

        <!-- Empty state -->
        <div
          v-if="filtered.length === 0"
          class="flex flex-col items-center justify-center py-20 text-muted-foreground"
        >
          <div class="text-3xl mb-3">🔍</div>
          <div class="text-sm">No issues match your filters</div>
          <button
            v-if="scopeFilter !== 'all' || selectedBoards.size > 0 || searchQuery"
            class="mt-3 text-xs text-primary hover:underline"
            @click="scopeFilter = 'all'; selectedBoards = new Set(); searchQuery = ''"
          >
            Clear filters
          </button>
        </div>
      </div>
    </div>
  </div>

  <JiraCreateTicketModal
    :open="createOpen"
    @close="createOpen = false"
    @created="(item: WorkItem) => allItems.push(item)"
  />
</template>
