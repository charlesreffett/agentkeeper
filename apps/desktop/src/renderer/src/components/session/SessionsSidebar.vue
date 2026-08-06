<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckSquare, ChevronRight, Folder, Plus, Square, Trash2, TriangleAlert } from 'lucide-vue-next'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useUnifiedSessions, type UnifiedSession } from '@/composables/useUnifiedSessions'
import { formatRelativeTime } from '@/lib/format'
import { projectColor } from '@/lib/projectColor'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { LiveSessionStatus } from '@shared/ipc-contract'

const props = defineProps<{
  collapsed: boolean
  activeId: string
}>()

defineEmits<{ collapse: []; expand: [] }>()

const router = useRouter()
const { unifiedSessions, open, createNewSession, remove } = useUnifiedSessions()

const filterText = ref('')
const selectedProjectPath = ref<string | null>(null)
const projectFilterOpen = ref(false)

const activeProjects = computed(() => {
  const map = new Map<string, { path: string; name: string; count: number }>()
  for (const s of unifiedSessions.value) {
    if (!s.projectPath) continue
    const existing = map.get(s.projectPath)
    if (existing) {
      existing.count++
    } else {
      map.set(s.projectPath, { path: s.projectPath, name: s.projectName, count: 1 })
    }
  }
  return Array.from(map.values())
})

const selectedProject = computed(
  () => activeProjects.value.find((p) => p.path === selectedProjectPath.value) ?? null,
)

const sessions = computed(() => {
  const q = filterText.value.toLowerCase().trim()
  const filtered = unifiedSessions.value.filter((s) => {
    if (selectedProjectPath.value && s.projectPath !== selectedProjectPath.value) return false
    if (!q) return true
    return (
      (s.workItemKey ?? '').toLowerCase().includes(q) ||
      (s.workItemTitle ?? '').toLowerCase().includes(q) ||
      (s.title ?? '').toLowerCase().includes(q) ||
      s.initialPrompt.toLowerCase().includes(q)
    )
  })
  return filtered.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt)
})

function statusDotClass(status: LiveSessionStatus | 'inactive'): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'blocked':
      return 'bg-blue-500'
    case 'completed':
    case 'inactive':
      return 'bg-muted-foreground/40'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground/40'
  }
}

function projectName(path: string | null): string {
  if (!path) return ''
  return path.split('/').at(-1) ?? path
}

function contextDotColor(path: string | null): string {
  if (!path) return 'hsl(0, 0%, 55%)'
  return projectColor(projectName(path))
}

function onRowClick(entry: UnifiedSession) {
  open(entry)
}

async function handleNew() {
  const localId = await createNewSession()
  if (!localId) void router.push('/')
}

// ── Multi-select + bulk delete ───────────────────────────────────────────────

const selectedIds = ref(new Set<string>())
const confirmDeleteSelectedOpen = ref(false)
const confirmDeleteAllOpen = ref(false)
const confirmDeleteSingleOpen = ref(false)
const singleDeleteTarget = ref<UnifiedSession | null>(null)

const selectedCount = computed(() => selectedIds.value.size)
const allSelected = computed(() => sessions.value.length > 0 && selectedCount.value === sessions.value.length)

const selectionWarning = computed(() => {
  const sel = sessions.value.filter((s) => selectedIds.value.has(s.localId))
  const running = sel.filter((s) => s.status === 'running' || s.status === 'starting').length
  const blocked = sel.filter((s) => s.status === 'blocked').length
  return { running, blocked, any: running + blocked > 0 }
})

const allWarning = computed(() => {
  const running = sessions.value.filter(
    (s) => s.status === 'running' || s.status === 'starting',
  ).length
  const blocked = sessions.value.filter((s) => s.status === 'blocked').length
  return { running, blocked, any: running + blocked > 0 }
})

const singleWarning = computed(() => {
  const target = singleDeleteTarget.value
  if (!target) return { running: 0, blocked: 0, any: false }
  const running = target.status === 'running' || target.status === 'starting' ? 1 : 0
  const blocked = target.status === 'blocked' ? 1 : 0
  return { running, blocked, any: running + blocked > 0 }
})

function warningText(w: { running: number; blocked: number }): string {
  const parts: string[] = []
  if (w.running > 0) parts.push(`${w.running} running`)
  if (w.blocked > 0) parts.push(`${w.blocked} blocked`)
  return parts.join(' · ')
}

function toggleSelectCard(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(sessions.value.map((s) => s.localId))
}

function clearSelection() {
  selectedIds.value = new Set()
}

function confirmDeleteSingle(entry: UnifiedSession) {
  singleDeleteTarget.value = entry
  confirmDeleteSingleOpen.value = true
}

function handleDeleteSelected() {
  confirmDeleteSelectedOpen.value = true
}

function handleDeleteAll() {
  confirmDeleteAllOpen.value = true
}

async function executeDeleteSelected() {
  const toDelete = sessions.value.filter((s) => selectedIds.value.has(s.localId))
  await Promise.all(toDelete.map(remove))
  selectedIds.value = new Set()
  if (toDelete.some((s) => s.localId === props.activeId)) void router.push('/sessions')
}

async function executeDeleteAll() {
  const deletedActive = sessions.value.some((s) => s.localId === props.activeId)
  await Promise.all(sessions.value.map(remove))
  selectedIds.value = new Set()
  if (deletedActive) void router.push('/sessions')
}

async function executeDeleteSingle() {
  const target = singleDeleteTarget.value
  if (!target) return
  await remove(target)
  selectedIds.value.delete(target.localId)
  singleDeleteTarget.value = null
  if (target.localId === props.activeId) void router.push('/sessions')
}
</script>

<template>
  <!-- Collapsed strip -->
  <div
    v-if="collapsed"
    class="w-7 shrink-0 flex flex-col items-center pt-2 border-r border-border"
  >
    <button
      class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
      title="Expand sessions"
      @click="$emit('expand')"
    >
      <ChevronRight class="size-3.5" />
    </button>
  </div>

  <!-- Expanded panel -->
  <div
    v-else
    class="w-[260px] shrink-0 flex flex-col border-r border-border overflow-hidden"
  >
    <!-- Header -->
    <div class="p-2 shrink-0 border-b border-border">
      <Button class="w-full gap-1.5" @click="handleNew">
        <Plus class="size-3.5" />
        New session
      </Button>
    </div>

    <!-- Filter -->
    <div class="px-2 py-1.5 border-b border-border/50 flex items-center gap-1">
      <input
        v-model="filterText"
        type="text"
        placeholder="Filter sessions…"
        class="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none px-1"
      />
      <Popover v-if="activeProjects.length > 1" v-model:open="projectFilterOpen">
        <PopoverTrigger as-child>
          <button
            class="shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors"
            :class="selectedProjectPath === null
              ? 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
              : 'border-primary/50 bg-primary/10 text-foreground'"
          >
            <span
              v-if="selectedProject"
              class="size-1.5 rounded-full shrink-0"
              :style="{ backgroundColor: contextDotColor(selectedProjectPath) }"
            />
            <Folder class="size-3" />
            <span class="max-w-[90px] truncate">{{ selectedProject?.name ?? 'All projects' }}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent class="w-64 p-1" align="end">
          <button
            class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors hover:bg-accent"
            :class="selectedProjectPath === null ? 'bg-accent/50' : ''"
            @click="selectedProjectPath = null; projectFilterOpen = false"
          >
            <Folder class="size-4 shrink-0 text-muted-foreground" />
            <span class="flex-1 min-w-0 truncate text-left">All projects · {{ unifiedSessions.length }}</span>
          </button>
          <template v-for="p in activeProjects" :key="p.path">
            <button
              class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded transition-colors hover:bg-accent"
              :class="selectedProjectPath === p.path ? 'bg-accent/50' : ''"
              @click="selectedProjectPath = p.path; projectFilterOpen = false"
            >
              <span
                class="size-2.5 rounded-full shrink-0"
                :style="{ backgroundColor: contextDotColor(p.path) }"
              />
              <span class="flex-1 min-w-0 truncate text-left">{{ p.name }}</span>
              <span class="text-xs text-muted-foreground tabular-nums">{{ p.count }}</span>
            </button>
          </template>
        </PopoverContent>
      </Popover>
    </div>

    <!-- Selection bar -->
    <div
      v-if="selectedCount > 0"
      class="px-2 py-1.5 border-b border-border/50 flex flex-col gap-1.5 shrink-0"
    >
      <div class="flex items-center justify-between gap-2">
        <button
          class="inline-flex items-center gap-1 text-[11px] font-medium transition-colors"
          :class="allSelected ? 'text-primary' : 'text-foreground hover:text-primary'"
          @click="allSelected ? clearSelection() : selectAll()"
        >
          <component :is="allSelected ? CheckSquare : Square" class="size-3.5" />
          Select all
        </button>
        <span class="text-[11px] text-muted-foreground tabular-nums">
          {{ selectedCount }} / {{ sessions.length }} selected
        </span>
        <button
          v-if="selectedCount > 0"
          class="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          @click="clearSelection"
        >
          Clear
        </button>
      </div>
      <div class="flex items-center gap-1.5">
        <button
          class="flex-1 inline-flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium border border-border/60 transition-colors disabled:opacity-40"
          :class="selectedCount > 0 ? 'text-destructive border-destructive/40 hover:bg-destructive/10' : 'text-muted-foreground'"
          :disabled="selectedCount === 0"
          @click="handleDeleteSelected"
        >
          <Trash2 class="size-3" />
          Delete ({{ selectedCount }})
        </button>
        <button
          class="flex-1 inline-flex items-center justify-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium border border-border/60 transition-colors disabled:opacity-40"
          :class="sessions.length > 0 ? 'text-destructive border-destructive/40 hover:bg-destructive/10' : 'text-muted-foreground'"
          :disabled="sessions.length === 0"
          @click="handleDeleteAll"
        >
          <Trash2 class="size-3" />
          Delete all
        </button>
      </div>
    </div>

    <!-- Session list -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-for="s in sessions"
        :key="s.localId"
        class="w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors cursor-pointer"
        :class="s.localId === activeId ? 'bg-muted' : 'hover:bg-muted/50'"
        @click="onRowClick(s)"
      >
        <!-- Row 1: checkbox + dot + title -->
        <div class="flex items-center gap-1.5 mb-0.5">
          <Checkbox
            :checked="selectedIds.has(s.localId)"
            @click.stop="toggleSelectCard(s.localId)"
          />
          <span class="size-1.5 rounded-full shrink-0" :class="statusDotClass(s.status)" />
          <span v-if="s.isDraft" class="text-[9px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400 shrink-0">
            Draft
          </span>
          <span class="text-[12px] font-medium text-foreground line-clamp-1 min-w-0">
            {{ s.title }}
          </span>
        </div>

        <!-- Row 2: context badge + ticket + time -->
        <div class="flex items-center gap-1.5 pl-3">
          <span
            v-if="s.projectPath"
            class="size-1.5 rounded-full shrink-0"
            :style="{ backgroundColor: contextDotColor(s.projectPath) }"
          />
          <span class="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0">
            {{ [projectName(s.projectPath), s.workItemKey].filter(Boolean).join(' · ') }}
          </span>
          <span class="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">
            {{ formatRelativeTime(s.lastActivityAt) }}
          </span>
        </div>
      </div>

      <div
        v-if="sessions.length === 0"
        class="px-3 py-4 text-[12px] text-muted-foreground/50 text-center"
      >
        {{ unifiedSessions.length === 0 ? 'No sessions' : 'No matches' }}
      </div>
    </div>
  </div>

  <!-- Confirm: delete single -->
  <AlertDialog v-model:open="confirmDeleteSingleOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <div class="flex size-10 items-center justify-center rounded-full bg-destructive/10 mb-1">
          <TriangleAlert class="size-5 text-destructive" />
        </div>
        <AlertDialogTitle>Delete this session?</AlertDialogTitle>
        <AlertDialogDescription>
          {{ singleDeleteTarget?.title }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div
        v-if="singleWarning.any"
        class="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2"
      >
        <TriangleAlert class="size-4 shrink-0 mt-0.5" />
        <span>{{ warningText(singleWarning) }} — agents will be stopped immediately.</span>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          @click="executeDeleteSingle"
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Confirm: delete selected -->
  <AlertDialog v-model:open="confirmDeleteSelectedOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <div class="flex size-10 items-center justify-center rounded-full bg-destructive/10 mb-1">
          <TriangleAlert class="size-5 text-destructive" />
        </div>
        <AlertDialogTitle>Delete {{ selectedCount }} session{{ selectedCount === 1 ? '' : 's' }}?</AlertDialogTitle>
        <AlertDialogDescription>
          You're about to delete {{ selectedCount }} selected session{{ selectedCount === 1 ? '' : 's' }}. This can't be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div
        v-if="selectionWarning.any"
        class="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2"
      >
        <TriangleAlert class="size-4 shrink-0 mt-0.5" />
        <span>{{ warningText(selectionWarning) }} — agents will be stopped immediately.</span>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          @click="executeDeleteSelected"
        >
          Delete {{ selectedCount }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Confirm: delete all -->
  <AlertDialog v-model:open="confirmDeleteAllOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <div class="flex size-10 items-center justify-center rounded-full bg-destructive/10 mb-1">
          <TriangleAlert class="size-5 text-destructive" />
        </div>
        <AlertDialogTitle>Delete all {{ sessions.length }} sessions?</AlertDialogTitle>
        <AlertDialogDescription>
          This removes {{ sessions.length }} session{{ sessions.length === 1 ? '' : 's' }} currently in view. Plans, transcripts, and sub-agent history will be discarded.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div
        v-if="allWarning.any"
        class="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300 flex items-start gap-2"
      >
        <TriangleAlert class="size-4 shrink-0 mt-0.5" />
        <span>{{ warningText(allWarning) }} — agents will be stopped immediately.</span>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          @click="executeDeleteAll"
        >
          Delete {{ sessions.length }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
