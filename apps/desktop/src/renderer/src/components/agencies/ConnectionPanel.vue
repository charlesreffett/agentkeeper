<template>
  <div class="p-4 flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-foreground">Connection</h2>
      <button
        class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
        @click="emit('close')"
        title="Close"
      >
        ×
      </button>
    </div>

    <!-- Direction display -->
    <div class="flex items-center gap-2 font-mono text-sm">
      <span class="text-foreground">{{ edge.source }}</span>
      <span class="text-muted-foreground">→</span>
      <span class="text-foreground">{{ edge.target }}</span>
    </div>

<!-- Actions -->
    <div class="space-y-2">
      <button
        class="w-full text-xs bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded px-3 py-1.5 transition-colors text-left flex items-center gap-2"
        @click="emit('flip')"
      >
        <span>⇄</span>
        Flip direction
      </button>

      <button
        class="w-full text-xs bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 border border-red-600/30 rounded px-3 py-1.5 transition-colors text-left"
        @click="emit('remove')"
      >
        Remove connection
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GraphEdge } from '../graph/types'
import type { Agency } from '../../../../shared/ipc-contract'

defineProps<{
  edge: GraphEdge
  agency: Agency
}>()

const emit = defineEmits<{
  (e: 'flip'): void
  (e: 'remove'): void
  (e: 'close'): void
}>()
</script>
