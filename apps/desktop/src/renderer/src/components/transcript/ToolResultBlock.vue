<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, TriangleAlert } from '@/components/icons/app-icons'
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

// One-line summary shown in the collapsed header.
const summary = computed(() => {
  const first = rendered.value.split('\n')[0]?.trim() ?? ''
  return first.length > 80 ? first.slice(0, 80) + '…' : first
})

const lineCount = computed(() => rendered.value.split('\n').length)
</script>

<template>
  <details
    class="group rounded-lg border text-sm overflow-hidden"
    :class="
      block.is_error
        ? 'border-destructive/40 bg-destructive/5'
        : 'border-border/50 bg-muted/20'
    "
  >
    <summary
      class="cursor-pointer select-none px-3 py-2 flex items-center gap-2 transition-colors hover:bg-muted/40 list-none"
    >
      <ChevronRight
        class="size-3 shrink-0 text-muted-foreground/60 transition-transform group-open:rotate-90"
      />
      <TriangleAlert
        v-if="block.is_error"
        class="size-3 shrink-0 text-destructive"
      />
      <span
        class="font-mono text-xs truncate min-w-0"
        :class="block.is_error ? 'text-destructive' : 'text-muted-foreground'"
      >
        {{ summary || (block.is_error ? 'Tool error' : 'Result') }}
      </span>
      <span class="ml-auto text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
        {{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }}
      </span>
    </summary>
    <pre
      class="bg-background/40 border-t border-border/40 px-3 py-2.5 text-xs overflow-x-auto font-mono select-text m-0 text-muted-foreground leading-relaxed max-h-80"
    >{{ rendered }}</pre>
  </details>
</template>
