<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CheckSquare, Filter, Layers, Plus, RefreshCw, Square, Trash2, TriangleAlert } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import { Button } from '@/components/ui/button'
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
import SessionCard, { type SessionCardData } from '@/components/SessionCard.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useProjectStore } from '@/stores/project'
import { useSessionsListStore } from '@/stores/sessionsList'
import { projectColor } from '@/lib/projectColor'
import { cn } from '@/lib/utils'
import StatsCards from '@/components/StatsCards.vue'

const router = useRouter()
const sessionStore = useSessionStore()
const { projects, focusedProject } = useProjectsQuery()
const projectStore = useProjectStore()
const sessionsListStore = useSessionsListStore()
const loading = computed(() => sessionsListStore.loading)

const refreshKey = ref(0)
const statusCounts = computed(() => sessionStore.statusCounts)

// ── Persisted + historical data from disk ──────────────────────────────────

const persistedSessions = computed(() => sessionsListStore.persistedSessions)
const historicalSessions = computed(() => sessionsListStore.historicalSessions)

// Agency groups derived from persistedSessions
const agencyGroups = computed(() => {
  const groups = new Map<string, typeof persistedSessions.value[number][]>()
  for (const s of persistedSessions.value) {
    if (!s.agencyInstanceId) continue
    let list = groups.get(s.agencyInstanceId)
    if (!list) { list = []; groups.set(s.agencyInstanceId, list) }
    list.push(s)
  }
  return groups
})

watch(
  () => projects.value.length,
  (len) => { if (len > 0) void sessionsListStore.load(projects.value) },
  { immediate: true },
)
watch(refreshKey, () => {
  sessionsListStore.invalidate()
  void sessionsListStore.load(projects.value)
})

// ── Helpers ────────────────────────────────────────────────────────────────

function pathToProjectName(projectPath: string): string {
  const found = projects.value.find((p) => p.path === projectPath)
  if (found) return found.name
  return projectPath.split('/').pop() ?? projectPath
}

// ── Unified session list ───────────────────────────────────────────────────

const allSessions = computed((): SessionCardData[] => {
  const liveIds = new Set(sessionStore.visibleSessions.map((s) => s.localId))
  // Historical JSONL ids that already have a resumable persisted entry → skip in historical
  const persistedSdkIds = new Set(persistedSessions.value.map((s) => s.sdkSessionId).filter((id): id is string => id !== null))
  // SDK session ids already opened in-memory via openHistorical → also skip in historical
  const liveResumeSdkIds = new Set(
    Object.values(sessionStore.sessions)
      .map((s) => s.resumedFromSdkSessionId)
      .filter((id): id is string => id !== null),
  )

  const live: SessionCardData[] = sessionStore.visibleSessions.map((s) => {
    const name = pathToProjectName(s.projectPath)
    return {
      id: s.localId,
      title: s.workItemTitle ?? s.title ?? s.agencyPrompt ?? s.initialPrompt,
      status: s.status,
      source: 'live' as const,
      projectPath: s.projectPath,
      projectName: name,
      projectColor: projectColor(name),
      model: s.model,
      branch: s.branch,
      lastActivityAt: s.lastActivityAt,
      workItemKey: s.workItemKey,
      workItemTitle: s.workItemTitle,
      subAgentCount: sessionStore.subAgentCount(s),
      messageCount: null,
      events: s.events,
    }
  })

  const previous: SessionCardData[] = persistedSessions.value
    .filter((s) => !s.agencyInstanceId && !liveIds.has(s.localId))
    .map((s) => {
      const name = pathToProjectName(s.projectPath)
      return {
        id: s.localId,
        title: s.workItemTitle ?? s.title ?? s.initialPrompt,
        status: s.status,
        source: 'persisted' as const,
        projectPath: s.projectPath,
        projectName: name,
        projectColor: projectColor(name),
        model: s.model,
        branch: s.branch,
        lastActivityAt: s.lastActivityAt,
        workItemKey: s.workItemKey,
        workItemTitle: s.workItemTitle,
        subAgentCount: 0,
        messageCount: null,
        events: [],
      }
    })

  const agencies: SessionCardData[] = [...agencyGroups.value.entries()]
    .filter(([, members]) => !members.some((s) => liveIds.has(s.localId)))
    .map(([instanceId, members]) => {
      const entrySession = members.find((s) => !s.initialPrompt.startsWith('Agency "'))
      const projectPath = members[0]?.projectPath ?? ''
      const name = pathToProjectName(projectPath)
      const lastActivityAt = Math.max(...members.map((s) => s.lastActivityAt))
      return {
        id: instanceId,
        title: entrySession?.workItemTitle ?? entrySession?.title ?? entrySession?.initialPrompt.split('\n')[0] ?? members[0]?.agencyName ?? 'Agency session',
        status: 'inactive' as const,
        source: 'agency' as const,
        projectPath,
        projectName: name,
        projectColor: projectColor(name),
        model: null,
        branch: entrySession?.branch ?? members[0]?.branch ?? null,
        lastActivityAt,
        workItemKey: null,
        workItemTitle: entrySession?.workItemTitle ?? null,
        subAgentCount: 0,
        messageCount: null,
        events: [],
      }
    })

  // Historical JSONL — skip any that already appear as a persisted or in-memory live session
  const historical: SessionCardData[] = historicalSessions.value
    .filter(({ summary: s }) => !persistedSdkIds.has(s.id) && !liveResumeSdkIds.has(s.id))
    .map(({ projectPath, summary: s }) => {
      const name = pathToProjectName(projectPath)
      return {
        id: s.id,
        title: s.firstUserMessage ?? '(no user message)',
        status: 'inactive' as const,
        source: 'historical' as const,
        projectPath,
        projectName: name,
        projectColor: projectColor(name),
        model: s.model,
        branch: s.gitBranch,
        lastActivityAt: s.lastActivityAt,
        workItemKey: null,
        workItemTitle: null,
        subAgentCount: 0,
        messageCount: s.messageCount,
        events: [],
      }
    })

  return [...live, ...previous, ...agencies, ...historical].sort(
    (a, b) => b.lastActivityAt - a.lastActivityAt,
  )
})

// ── Project filter tabs ────────────────────────────────────────────────────

const activeProjects = computed(() => {
  const map = new Map<string, { path: string; name: string; count: number }>()
  for (const s of allSessions.value) {
    const existing = map.get(s.projectPath)
    if (existing) {
      existing.count++
    } else {
      map.set(s.projectPath, { path: s.projectPath, name: s.projectName, count: 1 })
    }
  }
  return Array.from(map.values())
})

const selectedProjectPath = ref<string | null>(null)

const filteredSessions = computed(() => {
  if (!selectedProjectPath.value) return allSessions.value
  return allSessions.value.filter((s) => s.projectPath === selectedProjectPath.value)
})

// ── Status line ────────────────────────────────────────────────────────────

const statusLine = computed(() => {
  const parts: string[] = []
  if (statusCounts.value.running > 0) parts.push(`${statusCounts.value.running} running`)
  if (statusCounts.value.blocked > 0) parts.push(`${statusCounts.value.blocked} blocked`)
  if (statusCounts.value.idle > 0) parts.push(`${statusCounts.value.idle} idle`)
  return parts.join(' · ') || 'No active sessions'
})

// ── Project filter helpers ─────────────────────────────────────────────────

function selectedPillStyle(name: string): Record<string, string> {
  const hue = parseInt(projectColor(name).match(/hsl\((\d+)/)![1] ?? '0')
  return {
    backgroundColor: `hsl(${hue}, 55%, 93%)`,
    borderColor: `hsl(${hue}, 50%, 72%)`,
    color: `hsl(${hue}, 65%, 38%)`,
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

function handleRefresh() {
  refreshKey.value++
}

async function handleNewSession() {
  const target = focusedProject.value ?? projectStore.currentProject
  if (target) {
    const settings = await window.agentkeeper.settings.get()
    projectStore.setProject(target)
    const localId = sessionStore.createOrFocusDraft({
      projectPath: target.path,
      defaultModel: settings.defaultModel,
      defaultEffort: settings.defaultEffort,
      defaultUseWorktree: settings.defaultUseWorktree,
    })
    void router.push(`/sessions/${localId}`)
    return
  }
  void router.push('/')
}

const isSelectMode = ref(false)
const selectedIds = ref(new Set<string>())
const confirmDeleteSelectedOpen = ref(false)
const confirmDeleteAllOpen = ref(false)

const selectedCount = computed(() => selectedIds.value.size)
const totalCount = computed(() => filteredSessions.value.length)
const allSelected = computed(() => totalCount.value > 0 && selectedCount.value === totalCount.value)

const scopeLabel = computed(() => {
  if (selectedProjectPath.value) {
    const proj = activeProjects.value.find((p) => p.path === selectedProjectPath.value)
    return proj ? proj.name : 'project'
  }
  return 'all projects'
})

const selectionWarning = computed(() => {
  const sel = filteredSessions.value.filter((s) => selectedIds.value.has(s.id))
  const running = sel.filter((s) => s.status === 'running' || s.status === 'starting').length
  const blocked = sel.filter((s) => s.status === 'blocked').length
  return { running, blocked, any: running + blocked > 0 }
})

const allWarning = computed(() => {
  const running = filteredSessions.value.filter(
    (s) => s.status === 'running' || s.status === 'starting',
  ).length
  const blocked = filteredSessions.value.filter((s) => s.status === 'blocked').length
  return { running, blocked, any: running + blocked > 0 }
})

function warningText(w: { running: number; blocked: number }): string {
  const parts: string[] = []
  if (w.running > 0) parts.push(`${w.running} running`)
  if (w.blocked > 0) parts.push(`${w.blocked} blocked`)
  return parts.join(' · ')
}

function toggleSelectMode() {
  isSelectMode.value = !isSelectMode.value
  if (!isSelectMode.value) selectedIds.value = new Set()
}

function toggleSelectCard(id: string) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAll() {
  selectedIds.value = new Set(filteredSessions.value.map((s) => s.id))
}

function clearSelection() {
  selectedIds.value = new Set()
}

async function deleteSingleSession(card: SessionCardData) {
  switch (card.source) {
    case 'live':
      await window.agentkeeper.sessions.terminate(card.id)
      sessionStore.dismiss(card.id)
      break
    case 'persisted':
      await window.agentkeeper.sessions.deletePersisted(card.id)
      sessionsListStore.removePersisted(card.id)
      break
    case 'agency': {
      const members = agencyGroups.value.get(card.id) ?? []
      await Promise.all(members.map((m) => window.agentkeeper.sessions.deletePersisted(m.localId)))
      sessionsListStore.removeAgency(card.id)
      break
    }
    case 'historical':
      await window.agentkeeper.sessions.deleteHistorical(card.projectPath, card.id)
      sessionsListStore.removeHistorical(card.projectPath, card.id)
      break
  }
}

function handleDeleteSelected() {
  confirmDeleteSelectedOpen.value = true
}

function handleDeleteAll() {
  confirmDeleteAllOpen.value = true
}

async function executeDeleteSelected() {
  const toDelete = filteredSessions.value.filter((s) => selectedIds.value.has(s.id))
  await Promise.all(toDelete.map(deleteSingleSession))
  selectedIds.value = new Set()
}

async function executeDeleteAll() {
  await Promise.all(filteredSessions.value.map(deleteSingleSession))
  selectedIds.value = new Set()
}

function handleCardClick(card: SessionCardData) {
  if (isSelectMode.value) return
  switch (card.source) {
    case 'live':
      void router.push(`/sessions/${card.id}`)
      break
    case 'persisted': {
      const session = persistedSessions.value.find((s) => s.localId === card.id)
      if (session) {
        const localId = sessionStore.openPersisted(session)
        void router.push(`/sessions/${localId}`)
      }
      break
    }
    case 'agency': {
      const members = agencyGroups.value.get(card.id) ?? []
      if (members.length > 0) {
        const localId = sessionStore.openPersistedAgency(members)
        if (localId) void router.push(`/sessions/${localId}`)
      }
      break
    }
    case 'historical': {
      const hist = historicalSessions.value.find(({ summary: s }) => s.id === card.id)
      if (hist) {
        const localId = sessionStore.openHistorical(hist.projectPath, hist.summary)
        void router.push(`/sessions/${localId}`)
      }
      break
    }
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Sessions" :description="statusLine">
      <template #actions>
        <Button variant="ghost" size="sm" class="gap-1.5" @click="handleRefresh">
          <RefreshCw class="size-3.5" />
          Refresh
        </Button>
        <Button variant="ghost" size="sm" class="gap-1.5" disabled>
          <Filter class="size-3.5" />
          Filter
        </Button>
        <Button
          :variant="isSelectMode ? 'secondary' : 'ghost'"
          size="sm"
          class="gap-1.5"
          @click="toggleSelectMode"
        >
          <CheckSquare class="size-3.5" />
          {{ isSelectMode ? 'Done' : 'Select' }}
        </Button>
        <Button size="sm" class="gap-1.5" @click="handleNewSession">
          <Plus class="size-3.5" />
          New session
        </Button>
      </template>
    </PageHeader>

    <div class="flex-1 overflow-auto flex flex-col gap-6 p-6">
    <!-- Project filter tabs -->
    <div v-if="activeProjects.length > 0" class="flex items-center gap-2 flex-wrap">
      <button
        :class="
          cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border',
            selectedProjectPath === null
              ? 'bg-primary/15 text-primary border-primary/50'
              : 'text-muted-foreground hover:text-foreground border-border hover:border-foreground/30',
          )
        "
        @click="selectedProjectPath = null"
      >
        <Layers class="size-3 shrink-0" />
        All projects
        <span class="tabular-nums inline-block min-w-[2ch] text-right">{{ allSessions.length }}</span>
      </button>

      <button
        v-for="proj in activeProjects"
        :key="proj.path"
        :class="
          cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border',
            selectedProjectPath === proj.path
              ? ''
              : 'text-muted-foreground hover:text-foreground border-border hover:border-foreground/30',
          )
        "
        :style="selectedProjectPath === proj.path ? selectedPillStyle(proj.name) : {}"
        @click="selectedProjectPath = proj.path"
      >
        <span
          class="size-2 rounded-full shrink-0"
          :style="{ backgroundColor: projectColor(proj.name) }"
        />
        {{ proj.name }}
        <span class="tabular-nums inline-block min-w-[2ch] text-right">{{ proj.count }}</span>
      </button>
    </div>

    <!-- Stats overview -->
    <StatsCards />

    <!-- Selection action bar -->
    <div
      v-if="isSelectMode"
      class="flex items-center justify-between gap-4 px-3 py-2.5 rounded-lg border bg-muted/40"
    >
      <div class="flex items-center gap-4 text-sm">
        <button
          class="inline-flex items-center gap-1.5 font-medium transition-colors"
          :class="allSelected ? 'text-primary' : 'text-foreground hover:text-primary'"
          @click="allSelected ? clearSelection() : selectAll()"
        >
          <component :is="allSelected ? CheckSquare : Square" class="size-4" />
          Select all
        </button>
        <span class="text-muted-foreground">
          <template v-if="selectedCount > 0">
            <span class="text-primary font-medium">{{ selectedCount }}</span> of {{ totalCount }} selected
          </template>
          <template v-else>
            {{ totalCount }} session{{ totalCount === 1 ? '' : 's' }} in {{ scopeLabel }}
          </template>
        </span>
        <button
          v-if="selectedCount > 0"
          class="text-muted-foreground hover:text-foreground transition-colors"
          @click="clearSelection"
        >
          Clear
        </button>
      </div>
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          class="gap-1.5 transition-colors"
          :class="selectedCount > 0 ? 'text-destructive hover:text-destructive hover:bg-destructive/10' : 'text-muted-foreground'"
          :disabled="selectedCount === 0"
          @click="handleDeleteSelected"
        >
          <Trash2 class="size-3.5" />
          Delete selected{{ selectedCount > 0 ? ` (${selectedCount})` : '' }}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          class="gap-1.5"
          :disabled="totalCount === 0"
          @click="handleDeleteAll"
        >
          <Trash2 class="size-3.5" />
          Delete all ({{ totalCount }})
        </Button>
      </div>
    </div>

    <!-- Unified session grid -->
    <div v-if="filteredSessions.length > 0" class="grid grid-cols-3 gap-4">
      <SessionCard
        v-for="card in filteredSessions"
        :key="card.id"
        :session="card"
        :select-mode="isSelectMode"
        :selected="selectedIds.has(card.id)"
        @click="handleCardClick(card)"
        @select="toggleSelectCard(card.id)"
      />
    </div>

    <!-- Loading state -->
    <div
      v-else-if="loading"
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
    >
      Loading…
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="flex-1 flex flex-col items-center justify-center gap-3"
    >
      <p class="text-sm text-muted-foreground">No sessions yet.</p>
      <Button size="sm" class="gap-1.5" @click="handleNewSession">
        <Plus class="size-3.5" />
        New session
      </Button>
    </div>

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
          <AlertDialogTitle>Delete all {{ totalCount }} sessions?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes {{ totalCount }} session{{ totalCount === 1 ? '' : 's' }} currently in view. Plans, transcripts, and sub-agent history will be discarded.
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
            Delete {{ totalCount }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </div>
  </div>
</template>
