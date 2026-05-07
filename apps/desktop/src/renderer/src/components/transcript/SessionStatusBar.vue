<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { CheckCircle2, Loader2 } from 'lucide-vue-next'
import type { LiveSessionStatus } from '@shared/ipc-contract'
import { toolDisplayName } from '@/lib/verbosity'

const props = defineProps<{
  status: LiveSessionStatus
  currentToolName: string | null
  turnStartedAt: number | null
  turnEndedAt: number | null
}>()

// Ticks every second while running to keep the elapsed display live.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

watch(
  () => props.status,
  (s) => {
    const active = s === 'running' || s === 'starting'
    if (active && !timer) {
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    } else if (!active && timer) {
      clearInterval(timer)
      timer = null
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

const isActive = computed(
  () => props.status === 'running' || props.status === 'starting',
)

const toolLabel = computed(() =>
  props.currentToolName ? `${toolDisplayName(props.currentToolName)}…` : 'Working…',
)

const elapsedText = computed(() =>
  props.turnStartedAt ? formatDuration(now.value - props.turnStartedAt) : '',
)

// Shown when idle and a completed turn exists. Persists until the next turn clears it.
const doneText = computed(() => {
  if (!props.turnStartedAt || !props.turnEndedAt) return null
  return `Done · ${formatDuration(props.turnEndedAt - props.turnStartedAt)}`
})

const visible = computed(() => isActive.value || doneText.value !== null)
</script>

<template>
  <div
    v-if="visible"
    class="shrink-0 border-t border-border/50 px-6 py-1.5 flex items-center gap-2 text-xs text-muted-foreground select-none"
  >
    <template v-if="isActive">
      <Loader2 class="size-3 animate-spin shrink-0" />
      <span>{{ toolLabel }}</span>
      <span v-if="elapsedText" class="ml-auto tabular-nums">{{ elapsedText }}</span>
    </template>
    <template v-else-if="doneText">
      <CheckCircle2 class="size-3 shrink-0 text-emerald-500" />
      <span>{{ doneText }}</span>
    </template>
  </div>
</template>
