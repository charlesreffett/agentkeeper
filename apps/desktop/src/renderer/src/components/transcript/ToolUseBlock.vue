<script setup lang="ts">
import { computed } from 'vue'
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

const preview = computed(() => {
  const input = props.block.input
  if (!input || typeof input !== 'object') return ''
  const o = input as Record<string, unknown>
  // Common hints by tool
  if (typeof o['file_path'] === 'string') return String(o['file_path'])
  if (typeof o['command'] === 'string') return String(o['command'])
  if (typeof o['pattern'] === 'string') return String(o['pattern'])
  if (typeof o['path'] === 'string') return String(o['path'])
  if (typeof o['url'] === 'string') return String(o['url'])
  if (typeof o['description'] === 'string') return String(o['description'])
  return ''
})
</script>

<template>
  <details
    class="rounded border border-border bg-muted/30 text-sm overflow-hidden"
  >
    <summary
      class="cursor-pointer select-none px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition"
    >
      <span class="text-xs font-mono font-medium shrink-0">
        {{ block.name }}
      </span>
      <span
        v-if="preview"
        class="text-xs text-muted-foreground font-mono truncate min-w-0"
      >
        {{ preview }}
      </span>
    </summary>
    <pre
      class="bg-background/50 border-t border-border p-3 text-xs overflow-x-auto font-mono select-text m-0"
    >{{ inputJson }}</pre>
  </details>
</template>
