<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { SessionSummary } from '@shared/ipc-contract'
import { formatRelativeTime, shortModel } from '@/lib/format'
import { useSessionStore } from '@/stores/sessions'
import type { LiveSession } from '@/stores/sessions'

const props = defineProps<{
  projectPath: string
  selectedHistoricalId: string | null
  refreshKey: number
}>()

const emit = defineEmits<{
  selectHistorical: [session: SessionSummary]
  selectLive: [session: LiveSession]
}>()

const store = useSessionStore()

// Only show live sessions that belong to this project
const liveForProject = computed(() =>
  store.liveList.filter((s) => s.projectPath === props.projectPath),
)

const historical = ref<SessionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    historical.value = await window.orchestral.sessions.list(props.projectPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    historical.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.projectPath, props.refreshKey],
  () => {
    void load()
  },
  { immediate: true },
)

function liveFirstMessage(s: LiveSession): string {
  return s.initialPrompt.trim().split('\n')[0] ?? '(new session)'
}

function liveStatusLabel(s: LiveSession): string {
  switch (s.status) {
    case 'starting':
      return 'Starting'
    case 'running':
      return 'Working'
    case 'idle':
      return 'Idle'
    case 'completed':
      return 'Completed'
    case 'cancelled':
      return 'Cancelled'
    case 'error':
      return 'Error'
  }
}

function liveStatusDot(s: LiveSession): string {
  switch (s.status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
      return 'bg-amber-500'
    case 'completed':
    case 'cancelled':
      return 'bg-muted-foreground'
    case 'error':
      return 'bg-destructive'
  }
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Live -->
    <section v-if="liveForProject.length" class="shrink-0">
      <div
        class="px-4 py-2 border-b border-border flex items-center justify-between"
      >
        <h2
          class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          Live
        </h2>
        <span class="text-xs text-muted-foreground tabular-nums">
          {{ liveForProject.length }}
        </span>
      </div>
      <ul>
        <li
          v-for="s in liveForProject"
          :key="s.localId"
          class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
          :class="store.currentLiveId === s.localId ? 'bg-accent' : ''"
          @click="emit('selectLive', s)"
        >
          <div class="flex items-center gap-2">
            <span class="size-1.5 rounded-full shrink-0" :class="liveStatusDot(s)" />
            <div class="text-sm font-medium truncate leading-snug flex-1 min-w-0">
              {{ liveFirstMessage(s) }}
            </div>
          </div>
          <div
            class="mt-1 pl-3.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
          >
            <span>{{ liveStatusLabel(s) }}</span>
            <span>·</span>
            <span>{{ s.events.length }} msg</span>
            <span v-if="shortModel(s.model)">·</span>
            <span v-if="shortModel(s.model)" class="font-mono">
              {{ shortModel(s.model) }}
            </span>
          </div>
        </li>
      </ul>
    </section>

    <!-- Historical -->
    <section class="flex-1 min-h-0 flex flex-col">
      <div
        class="px-4 py-2 border-b border-border flex items-center justify-between shrink-0"
      >
        <h2
          class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          Recent
        </h2>
        <span v-if="!loading" class="text-xs text-muted-foreground tabular-nums">
          {{ historical.length }}
        </span>
      </div>

      <div v-if="loading" class="p-4 text-sm text-muted-foreground">
        Loading…
      </div>

      <div v-else-if="error" class="p-4 text-sm text-destructive">
        {{ error }}
      </div>

      <div
        v-else-if="historical.length === 0"
        class="p-4 text-sm text-muted-foreground leading-relaxed"
      >
        No historical sessions.
      </div>

      <ul v-else class="overflow-y-auto">
        <li
          v-for="s in historical"
          :key="s.id"
          class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
          :class="selectedHistoricalId === s.id ? 'bg-accent' : ''"
          @click="emit('selectHistorical', s)"
        >
          <div class="text-sm font-medium truncate leading-snug">
            {{ s.firstUserMessage || '(no user message)' }}
          </div>
          <div
            class="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
          >
            <span>{{ formatRelativeTime(s.lastActivityAt) }}</span>
            <span>·</span>
            <span>{{ s.messageCount }} msg</span>
            <span v-if="shortModel(s.model)">·</span>
            <span v-if="shortModel(s.model)" class="font-mono">
              {{ shortModel(s.model) }}
            </span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
