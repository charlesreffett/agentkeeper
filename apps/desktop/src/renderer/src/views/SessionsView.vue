<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Filter, Layers, Plus, RefreshCw } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import SessionCard, { type SessionCardData } from '@/components/SessionCard.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useProjectStore } from '@/stores/project'
import { projectColor } from '@/lib/projectColor'
import { cn } from '@/lib/utils'
import StatsCards from '@/components/StatsCards.vue'
import type { PersistedAgency, PersistedSession, SessionSummary } from '@shared/ipc-contract'

const router = useRouter()
const sessionStore = useSessionStore()
const projectsStore = useProjectsStore()
const projectStore = useProjectStore()

const refreshKey = ref(0)
const statusCounts = computed(() => sessionStore.statusCounts)

// ── Persisted + historical data from disk ──────────────────────────────────

const persistedSessions = ref<PersistedSession[]>([])
const persistedAgencies = ref<PersistedAgency[]>([])
const historicalSessions = ref<{ projectPath: string; summary: SessionSummary }[]>([])

async function loadPersistedAndHistorical() {
  const projects = projectsStore.projects
  if (!projects.length) return

  const allPersisted: PersistedSession[] = []
  const allAgencies: PersistedAgency[] = []
  const allHistorical: { projectPath: string; summary: SessionSummary }[] = []

  await Promise.all(
    projects.map(async (p) => {
      try {
        const [sessions, agencies, historical] = await Promise.all([
          window.agentkeeper.sessions.listPersisted(p.path),
          window.agentkeeper.agencies.listPersisted(p.path),
          window.agentkeeper.sessions.list(p.path),
        ])
        allPersisted.push(...sessions)
        allAgencies.push(...agencies)
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

  const seenAgencies = new Set<string>()
  persistedAgencies.value = allAgencies.filter((a) => {
    if (seenAgencies.has(a.instanceId)) return false
    seenAgencies.add(a.instanceId)
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
}

watch(
  () => projectsStore.projects.length,
  (len) => { if (len > 0) void loadPersistedAndHistorical() },
  { immediate: true },
)
watch(refreshKey, () => { void loadPersistedAndHistorical() })

// ── Helpers ────────────────────────────────────────────────────────────────

function pathToProjectName(projectPath: string): string {
  const found = projectsStore.projects.find((p) => p.path === projectPath)
  if (found) return found.name
  return projectPath.split('/').pop() ?? projectPath
}

// ── Unified session list ───────────────────────────────────────────────────

const allSessions = computed((): SessionCardData[] => {
  const liveIds = new Set(sessionStore.visibleSessions.map((s) => s.localId))
  // Historical JSONL ids that already have a resumable persisted entry → skip in historical
  const persistedSdkIds = new Set(persistedSessions.value.map((s) => s.sdkSessionId))

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

  const agencies: SessionCardData[] = persistedAgencies.value
    .filter((a) => {
      const members = persistedSessions.value.filter((s) => s.agencyInstanceId === a.instanceId)
      return !members.some((s) => liveIds.has(s.localId))
    })
    .map((a) => {
      const name = pathToProjectName(a.projectPath)
      return {
        id: a.instanceId,
        title: a.workItemTitle ?? a.title ?? a.agencyName,
        status: 'inactive' as const,
        source: 'agency' as const,
        projectPath: a.projectPath,
        projectName: name,
        projectColor: projectColor(name),
        model: null,
        branch: a.branch,
        lastActivityAt: a.lastActivityAt,
        workItemKey: null,
        workItemTitle: a.workItemTitle ?? null,
        subAgentCount: 0,
        messageCount: null,
        events: [],
      }
    })

  // Historical JSONL — skip any that already appear as a resumable persisted session
  const historical: SessionCardData[] = historicalSessions.value
    .filter(({ summary: s }) => !persistedSdkIds.has(s.id))
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

// ── Actions ────────────────────────────────────────────────────────────────

function handleRefresh() {
  refreshKey.value++
}

async function handleNewSession() {
  if (projectStore.currentProject) {
    void router.push('/project')
    return
  }
  if (projectsStore.focusedProject) {
    projectStore.setProject(projectsStore.focusedProject)
    void router.push('/project')
    return
  }
  void router.push('/project')
}

function handleCardClick(card: SessionCardData) {
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
      const agency = persistedAgencies.value.find((a) => a.instanceId === card.id)
      if (agency) {
        const members = persistedSessions.value.filter(
          (s) => s.agencyInstanceId === agency.instanceId,
        )
        const localId = sessionStore.openPersistedAgency(agency, members)
        if (localId) void router.push(`/sessions/${localId}`)
      }
      break
    }
    case 'historical':
      void router.push(`/sessions/${card.id}`)
      break
  }
}
</script>

<template>
  <div class="h-full overflow-auto flex flex-col gap-6 p-6">
    <!-- Page header -->
    <div class="flex items-start justify-between gap-4">
      <div class="flex flex-col gap-0.5">
        <h1 class="text-2xl font-bold">Sessions</h1>
        <p class="text-sm text-muted-foreground">{{ statusLine }}</p>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <Button variant="ghost" size="sm" class="gap-1.5" @click="handleRefresh">
          <RefreshCw class="size-3.5" />
          Refresh
        </Button>
        <Button variant="ghost" size="sm" class="gap-1.5" disabled>
          <Filter class="size-3.5" />
          Filter
        </Button>
        <Button size="sm" class="gap-1.5" @click="handleNewSession">
          <Plus class="size-3.5" />
          New session
        </Button>
      </div>
    </div>

    <!-- Project filter tabs -->
    <div v-if="activeProjects.length > 0" class="flex items-center gap-2 flex-wrap">
      <button
        :class="
          cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border',
            selectedProjectPath === null
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'text-muted-foreground hover:text-foreground border-border',
          )
        "
        @click="selectedProjectPath = null"
      >
        <Layers class="size-3 shrink-0" />
        All projects {{ allSessions.length }}
      </button>

      <button
        v-for="proj in activeProjects"
        :key="proj.path"
        :class="
          cn(
            'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border',
            selectedProjectPath === proj.path
              ? 'bg-primary/10 text-primary border-primary/30'
              : 'text-muted-foreground hover:text-foreground border-border',
          )
        "
        @click="selectedProjectPath = proj.path"
      >
        <span
          class="size-2 rounded-full shrink-0"
          :style="{ backgroundColor: projectColor(proj.name) }"
        />
        {{ proj.name }} {{ proj.count }}
      </button>
    </div>

    <!-- Stats overview -->
    <StatsCards />

    <!-- Unified session grid -->
    <div v-if="filteredSessions.length > 0" class="grid grid-cols-3 gap-4">
      <SessionCard
        v-for="card in filteredSessions"
        :key="card.id"
        :session="card"
        @click="handleCardClick(card)"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else
      class="flex-1 flex items-center justify-center text-sm text-muted-foreground"
    >
      No sessions yet.
    </div>
  </div>
</template>
