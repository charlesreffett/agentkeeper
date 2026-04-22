<script setup lang="ts">
import { computed } from 'vue'
import type { ContentBlock } from '@shared/ipc-contract'

const props = defineProps<{
  block: ContentBlock
}>()

const label = computed(() => {
  const b = props.block as { type?: unknown }
  return typeof b.type === 'string' ? b.type : 'unknown'
})

const rendered = computed(() => {
  try {
    return JSON.stringify(props.block, null, 2)
  } catch {
    return String(props.block)
  }
})
</script>

<template>
  <details
    class="rounded border border-dashed border-border text-xs overflow-hidden"
  >
    <summary
      class="cursor-pointer select-none px-3 py-2 text-muted-foreground font-mono"
    >
      {{ label }}
    </summary>
    <pre
      class="bg-background/50 border-t border-border p-3 overflow-x-auto font-mono select-text m-0"
    >{{ rendered }}</pre>
  </details>
</template>
