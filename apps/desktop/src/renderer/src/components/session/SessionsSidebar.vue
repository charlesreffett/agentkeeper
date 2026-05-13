<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight, Plus } from 'lucide-vue-next'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionsListQuery } from '@/composables/useSessionsListQuery'
import { useProjectStore } from '@/stores/project'
import { formatRelativeTime } from '@/lib/format'
import type { LiveSessionStatus } from '@shared/ipc-contract'

const props = defineProps<{
  collapsed: boolean
  activeId: string
}>()

defineEmits<{ collapse: []; expand: [] }>()

const router = useRouter()
const sessionStore = useSessionStore()
const projectStore = useProjectStore()
const { focusedProject, projects } = useProjectsQuery()
const { persistedSessions } = useSessionsListQuery(projects)

const filterText = ref('')

const sessions = computed(() => {
  const liveIds = new Set(sessionStore.visibleSessions.map((s) => s.localId))

  const live = sessionStore.visibleSessions.filter((s) => !s.isDraft)

  const previous = persistedSessions.value
    .filter((s) => !liveIds.has(s.localId))
    .map((s) => ({
      localId: s.localId,
      status: s.status,
      workItemKey: s.workItemKey ?? null,
      workItemTitle: s.workItemTitle ?? null,
      title: s.title ?? null,
      initialPrompt: s.initialPrompt,
      lastActivityAt: s.lastActivityAt,
    }))

  const all = [...live, ...previous]

  const q = filterText.value.toLowerCase().trim()
  const filtered = q
    ? all.filter(
        (s) =>
          (s.workItemKey ?? '').toLowerCase().includes(q) ||
          (s.workItemTitle ?? '').toLowerCase().includes(q) ||
          (s.title ?? '').toLowerCase().includes(q) ||
          s.initialPrompt.toLowerCase().includes(q),
      )
    : all
  return filtered.slice().sort((a, b) => b.lastActivityAt - a.lastActivityAt)
})

function statusDotClass(status: LiveSessionStatus): string {
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
    case 'terminated':
      return 'bg-muted-foreground/40'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground/40'
  }
}

function itemTitle(s: (typeof sessions.value)[number]): string {
  return s.workItemTitle ?? s.title ?? s.initialPrompt.split('\n')[0] ?? ''
}

// Show the dynamic title as a description only when a work item title is the primary heading.
function itemDescription(s: (typeof sessions.value)[number]): string | null {
  if (s.workItemTitle && s.title && s.title !== s.workItemTitle) return s.title
  return null
}

function isRunning(status: LiveSessionStatus): boolean {
  return status === 'running' || status === 'starting'
}

async function handleNew() {
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
    <div class="px-3 py-2 shrink-0 flex items-center justify-between border-b border-border">
      <span class="text-sm font-semibold text-foreground">Sessions</span>
      <button
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="handleNew"
      >
        <Plus class="size-3" />
        New
      </button>
    </div>

    <!-- Filter -->
    <div class="px-2 py-1.5 border-b border-border/50">
      <input
        v-model="filterText"
        type="text"
        placeholder="Filter sessions…"
        class="w-full bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none px-1"
      />
    </div>

    <!-- Session list -->
    <div class="flex-1 overflow-y-auto">
      <button
        v-for="s in sessions"
        :key="s.localId"
        class="w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors"
        :class="
          s.localId === activeId
            ? 'bg-muted'
            : 'hover:bg-muted/50'
        "
        @click="router.push(`/sessions/${s.localId}`)"
      >
        <!-- Row 1: dot + key + time -->
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="size-1.5 rounded-full shrink-0" :class="statusDotClass(s.status)" />
          <span class="text-[11px] font-mono text-muted-foreground truncate flex-1 min-w-0">
            {{ s.workItemKey ?? 'no ticket' }}
          </span>
          <span class="text-[11px] text-muted-foreground/50 tabular-nums shrink-0">
            {{ formatRelativeTime(s.lastActivityAt) }}
          </span>
        </div>

        <!-- Row 2: main title -->
        <div class="text-[12px] font-medium text-foreground line-clamp-1 pl-3">
          {{ itemTitle(s) }}
        </div>

        <!-- Row 3: dynamic description (shown only when different from title) -->
        <div
          v-if="itemDescription(s)"
          class="text-[11px] pl-3 line-clamp-2 mt-0.5"
          :class="isRunning(s.status) ? 'text-primary/80' : 'text-muted-foreground'"
        >
          {{ itemDescription(s) }}
        </div>
      </button>

      <div
        v-if="sessions.length === 0"
        class="px-3 py-4 text-[12px] text-muted-foreground/50 text-center"
      >
        No sessions
      </div>
    </div>
  </div>
</template>
