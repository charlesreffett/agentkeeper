<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { CheckCircle2, Loader2 } from '@/components/icons/app-icons'
import type { LiveSessionStatus } from '@shared/ipc-contract'
import { toolDisplayName } from '@/lib/verbosity'

const props = defineProps({
  status: {
    type: String as PropType<LiveSessionStatus>,
    required: true,
  },
  currentTool: {
    type: Object as PropType<{ name: string; input: unknown } | null>,
    default: null,
  },
  turnStartedAt: {
    type: Number as PropType<number | null>,
    default: null,
  },
  turnEndedAt: {
    type: Number as PropType<number | null>,
    default: null,
  },
})

// Ticks every second while running to keep the elapsed display live.
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

watch(
  () => props.status,
  (s) => {
    const active = s === 'running' || s === 'starting'
    if (active && !timer) {
      now.value = Date.now()
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

function basename(p: string) {
  return p.split('/').pop() ?? p
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

const isActive = computed(
  () => props.status === 'running' || props.status === 'starting',
)

const toolLabel = computed(() => {
  if (!props.currentTool) return 'Working…'
  const { name, input } = props.currentTool
  const base = toolDisplayName(name)
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>
    const detail =
      typeof o['file_path'] === 'string' ? basename(o['file_path'] as string) :
      typeof o['pattern'] === 'string' ? `'${o['pattern']}'` :
      typeof o['query'] === 'string' ? `'${o['query']}'` :
      typeof o['path'] === 'string' ? basename(o['path'] as string) :
      typeof o['url'] === 'string' ? new URL(o['url'] as string).hostname :
      typeof o['command'] === 'string' ? truncate(o['command'] as string, 40) :
      typeof o['skill'] === 'string' ? o['skill'] as string :
      typeof o['to'] === 'string' ? o['to'] as string :
      null
    if (detail) return `${base} ${detail}`
  }
  return `${base}…`
})

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
