<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, KeyRound } from '@/components/icons/app-icons'
import type { ContentBlock } from '@shared/ipc-contract'

const props = defineProps<{
  block: Extract<ContentBlock, { type: 'tool_use' }>
}>()

const inputJson = computed(() => {
  try {
    return JSON.stringify(props.block.input, null, 2)
  } catch {
    return String(props.block.input)
  }
})

// Single best-fit argument preview for the row header.
const preview = computed(() => {
  const input = props.block.input
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  if (typeof o['file_path'] === 'string') return o['file_path'] as string
  if (typeof o['command'] === 'string') return o['command'] as string
  if (typeof o['pattern'] === 'string') return o['pattern'] as string
  if (typeof o['path'] === 'string') return o['path'] as string
  if (typeof o['url'] === 'string') return o['url'] as string
  if (typeof o['description'] === 'string') return o['description'] as string
  return ''
})
</script>

<template>
  <details class="group rounded-lg border border-border/50 bg-muted/20 text-sm overflow-hidden">
    <summary
      class="cursor-pointer select-none px-3 py-2 flex items-center gap-2 hover:bg-muted/40 transition-colors list-none"
    >
      <!-- Chevron rotates when open -->
      <ChevronRight
        class="size-3 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-90"
      />
      <!-- Tool icon -->
      <KeyRound class="size-3 shrink-0 text-sky-500/80" />
      <!-- Tool name -->
      <span class="font-mono text-xs font-medium text-sky-500 shrink-0">
        {{ block.name }}
      </span>
      <!-- Argument preview -->
      <span
        v-if="preview"
        class="text-xs text-muted-foreground font-mono truncate min-w-0"
      >
        ({{ preview }})
      </span>
      <!-- Status dot — always green; tool calls that errored surface via ToolResultBlock -->
      <span class="ml-auto size-2 rounded-full bg-emerald-500 shrink-0 opacity-80" />
    </summary>
    <!-- Expanded: full input JSON -->
    <pre
      class="bg-background/40 border-t border-border/40 px-3 py-2.5 text-xs overflow-x-auto font-mono select-text m-0 text-muted-foreground leading-relaxed"
    >{{ inputJson }}</pre>
  </details>
</template>
