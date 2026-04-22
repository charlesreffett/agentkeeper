<script setup lang="ts">
import { ref, watch } from 'vue'
import type { SessionSummary } from '@shared/ipc-contract'
import { formatRelativeTime, shortModel } from '@/lib/format'

const props = defineProps<{
  projectPath: string
  selectedId: string | null
  refreshKey: number
}>()

const emit = defineEmits<{ select: [session: SessionSummary] }>()

const sessions = ref<SessionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  loading.value = true
  error.value = null
  try {
    sessions.value = await window.orchestral.sessions.list(props.projectPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    sessions.value = []
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
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      class="px-4 py-3 border-b border-border flex items-center justify-between shrink-0"
    >
      <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Sessions
      </h2>
      <span v-if="!loading" class="text-xs text-muted-foreground tabular-nums">
        {{ sessions.length }}
      </span>
    </div>

    <div v-if="loading" class="p-4 text-sm text-muted-foreground">
      Loading…
    </div>

    <div v-else-if="error" class="p-4 text-sm text-destructive">
      {{ error }}
    </div>

    <div
      v-else-if="sessions.length === 0"
      class="p-4 text-sm text-muted-foreground leading-relaxed"
    >
      No sessions found.
      <div class="mt-2 text-xs">
        Sessions appear here after you've run
        <code class="font-mono">claude</code> in this project directory.
      </div>
    </div>

    <ul v-else class="overflow-y-auto">
      <li
        v-for="s in sessions"
        :key="s.id"
        class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
        :class="selectedId === s.id ? 'bg-accent' : ''"
        @click="emit('select', s)"
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
        <div
          v-if="s.gitBranch"
          class="mt-1 text-[10px] text-muted-foreground font-mono truncate"
        >
          {{ s.gitBranch }}
        </div>
      </li>
    </ul>
  </div>
</template>
