<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Trash2 } from '@/components/icons/app-icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { StatusDot, type StatusDotVariants } from '@/components/ui/status-dot'
import { useUnifiedSessions, type UnifiedSession } from '@/composables/useUnifiedSessions'
import { formatRelativeTime } from '@/lib/format'
import type { LiveSessionStatus } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean; activeId: string }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const router = useRouter()
const { unifiedSessions, remove } = useUnifiedSessions()
const query = ref('')
const projectFilter = ref('all')
const selectedIds = ref(new Set<string>())
const confirmDelete = ref(false)
const isDeleting = ref(false)
const deletedCount = ref(0)
const deleteTotal = ref(0)
const deleteError = ref('')
const deleteTargets = ref<UnifiedSession[]>([])

const projects = computed(() => {
  const values = new Map<string, string>()
  for (const session of unifiedSessions.value) {
    const key = session.projectPath ?? 'general'
    values.set(key, session.projectName || 'General')
  }
  return [...values.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
})

const visibleSessions = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return unifiedSessions.value.filter((session) => {
    const projectKey = session.projectPath ?? 'general'
    if (projectFilter.value !== 'all' && projectKey !== projectFilter.value) return false
    if (!needle) return true
    return [session.title, session.projectName, session.branch, session.agencyName]
      .some(value => value?.toLocaleLowerCase().includes(needle))
  })
})

const selectedSessions = computed(() =>
  unifiedSessions.value.filter(session => selectedIds.value.has(session.localId)),
)
const allVisibleSelected = computed(() =>
  visibleSessions.value.length > 0
  && visibleSessions.value.every(session => selectedIds.value.has(session.localId)),
)
const selectionLabel = computed(() => `${selectedIds.value.size} ${selectedIds.value.size === 1 ? 'session' : 'sessions'} selected`)

watch(() => props.open, (open) => {
  if (!open) return
  query.value = ''
  projectFilter.value = 'all'
  selectedIds.value = new Set()
  confirmDelete.value = false
  deletedCount.value = 0
  deleteTotal.value = 0
  deleteError.value = ''
  deleteTargets.value = []
})

watch(unifiedSessions, (sessions) => {
  const validIds = new Set(sessions.map(session => session.localId))
  selectedIds.value = new Set([...selectedIds.value].filter(id => validIds.has(id)))
})

function statusDotVariant(status: LiveSessionStatus | 'inactive'): StatusDotVariants['variant'] {
  switch (status) {
    case 'running':
    case 'starting': return 'running'
    case 'suspended': return 'suspended'
    case 'blocked': return 'blocked'
    case 'error': return 'error'
    default: return 'idle'
  }
}

function toggleSession(id: string) {
  const next = new Set(selectedIds.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selectedIds.value = next
}

function toggleVisible() {
  const next = new Set(selectedIds.value)
  if (allVisibleSelected.value) {
    for (const session of visibleSessions.value) next.delete(session.localId)
  } else {
    for (const session of visibleSessions.value) next.add(session.localId)
  }
  selectedIds.value = next
}

function askToDeleteSelected() {
  deleteTargets.value = [...selectedSessions.value]
  confirmDelete.value = true
}

async function deleteSelected() {
  if (isDeleting.value || deleteTargets.value.length === 0) return
  const sessions = [...deleteTargets.value]
  isDeleting.value = true
  deletedCount.value = 0
  deleteTotal.value = sessions.length
  deleteError.value = ''
  try {
    for (const session of sessions) {
      await remove(session)
      deletedCount.value += 1
    }
    if (sessions.some(session => session.localId === props.activeId)) {
      await router.push('/sessions')
    }
    selectedIds.value = new Set()
    confirmDelete.value = false
    emit('update:open', false)
  } catch (error) {
    deleteTargets.value = sessions.slice(deletedCount.value)
    const message = error instanceof Error ? error.message : 'Unable to delete all selected sessions.'
    deleteError.value = deletedCount.value
      ? `${deletedCount.value} deleted before an error occurred. ${message}`
      : message
    deletedCount.value = 0
    deleteTotal.value = 0
  } finally {
    isDeleting.value = false
  }
}
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex h-[min(780px,calc(100vh-3rem))] w-[min(1040px,calc(100vw-3rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
      <DialogHeader class="border-b border-border px-6 py-5">
        <DialogTitle>Session manager</DialogTitle>
        <DialogDescription>Select sessions and apply an action to all of them.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <div class="relative min-w-64 flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="query" class="pl-9" placeholder="Search sessions" aria-label="Search sessions" />
        </div>
        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Project</span>
          <select
            v-model="projectFilter"
            class="h-10 min-w-40 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            aria-label="Filter by project"
          >
            <option value="all">All projects</option>
            <option v-for="project in projects" :key="project.value" :value="project.value">{{ project.label }}</option>
          </select>
        </label>
      </div>

      <div class="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <label class="flex cursor-pointer items-center gap-2 text-sm font-medium">
          <Checkbox :model-value="allVisibleSelected" @update:model-value="toggleVisible" />
          Select all shown
        </label>
        <div class="flex items-center gap-3">
          <span class="text-sm tabular-nums text-muted-foreground">{{ selectionLabel }}</span>
          <Button
            variant="destructive"
            size="sm"
            class="gap-1.5"
            :disabled="selectedIds.size === 0"
            @click="askToDeleteSelected"
          >
            <Trash2 class="size-4" />
            Delete
          </Button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-6">
        <div v-if="visibleSessions.length" class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="session in visibleSessions"
            :key="session.localId"
            class="group flex min-h-36 flex-col rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="selectedIds.has(session.localId) ? 'border-primary bg-accent' : 'border-border bg-background hover:bg-accent/50'"
            role="button"
            tabindex="0"
            :aria-pressed="selectedIds.has(session.localId)"
            @click="toggleSession(session.localId)"
            @keydown.enter.prevent="toggleSession(session.localId)"
            @keydown.space.prevent="toggleSession(session.localId)"
          >
            <div class="flex w-full items-start gap-2">
              <Checkbox
                :model-value="selectedIds.has(session.localId)"
                class="mt-0.5"
                :aria-label="`Select ${session.title}`"
                @click.stop
                @update:model-value="toggleSession(session.localId)"
              />
              <div class="min-w-0 flex-1">
                <div class="line-clamp-2 text-sm font-medium leading-snug">{{ session.title }}</div>
                <div class="mt-1 truncate text-xs text-muted-foreground">{{ session.projectName || 'General' }}</div>
              </div>
            </div>
            <div class="mt-auto flex items-center gap-2 pt-4 text-xs text-muted-foreground">
              <StatusDot :variant="statusDotVariant(session.status)" />
              <span class="capitalize">{{ session.status }}</span>
              <span>·</span>
              <span>{{ formatRelativeTime(session.lastActivityAt) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
          {{ unifiedSessions.length ? 'No sessions match your filters.' : 'No sessions yet.' }}
        </div>
      </div>
    </DialogContent>
  </Dialog>

  <AlertDialog :open="confirmDelete" @update:open="(open) => { if (!isDeleting) confirmDelete = open }">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {{ deleteTargets.length }} {{ deleteTargets.length === 1 ? 'session' : 'sessions' }}?</AlertDialogTitle>
        <AlertDialogDescription>
          This permanently deletes the selected sessions and cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div class="max-h-40 overflow-y-auto rounded-md border border-border bg-background p-3">
        <ul class="space-y-1 text-sm">
          <li v-for="session in deleteTargets" :key="session.localId" class="truncate">• {{ session.title }}</li>
        </ul>
      </div>
      <div v-if="isDeleting || deletedCount" class="space-y-2">
        <p class="text-sm tabular-nums text-muted-foreground">Deleted {{ deletedCount }} of {{ deleteTotal }} sessions</p>
        <div class="h-2 overflow-hidden rounded-full bg-muted">
          <div
            class="h-full bg-primary transition-[width]"
            :style="{ width: `${deleteTotal ? (deletedCount / deleteTotal) * 100 : 0}%` }"
          />
        </div>
      </div>
      <p v-if="deleteError" class="text-sm text-destructive">{{ deleteError }}</p>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">Cancel</AlertDialogCancel>
        <Button variant="destructive" :disabled="isDeleting" @click="deleteSelected">
          {{ isDeleting ? 'Deleting…' : 'Delete' }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
