<script setup lang="ts">
import { computed } from 'vue'
import type { ContentBlock } from '@shared/ipc-contract'

const props = defineProps<{
  block: Extract<ContentBlock, { type: 'tool_result' }>
}>()

const rendered = computed(() => {
  const c = props.block.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    const texts: string[] = []
    for (const item of c) {
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        if (o['type'] === 'text' && typeof o['text'] === 'string') {
          texts.push(o['text'] as string)
        } else if (o['type'] === 'image') {
          texts.push('[image]')
        } else {
          texts.push(JSON.stringify(o))
        }
      }
    }
    return texts.join('\n')
  }
  try {
    return JSON.stringify(c, null, 2)
  } catch {
    return String(c)
  }
})

const lineCount = computed(() => rendered.value.split('\n').length)
</script>

<template>
  <details
    class="rounded border text-sm overflow-hidden"
    :class="
      block.is_error
        ? 'border-destructive/50 bg-destructive/5'
        : 'border-border bg-muted/20'
    "
  >
    <summary
      class="cursor-pointer select-none px-3 py-2 flex items-center gap-2 transition hover:bg-muted/40"
    >
      <span
        class="text-xs font-medium"
        :class="block.is_error ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ block.is_error ? 'Tool error' : 'Tool result' }}
      </span>
      <span class="text-xs text-muted-foreground tabular-nums ml-auto">
        {{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }}
      </span>
    </summary>
    <pre
      class="bg-background/50 border-t border-border p-3 text-xs overflow-x-auto font-mono select-text m-0 max-h-96"
    >{{ rendered }}</pre>
  </details>
</template>
