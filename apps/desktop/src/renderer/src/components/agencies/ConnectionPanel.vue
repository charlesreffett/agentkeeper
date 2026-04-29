<template>
  <div class="p-4 flex flex-col gap-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h2 class="text-sm font-semibold text-zinc-200">Connection</h2>
      <button
        class="text-zinc-500 hover:text-zinc-200 transition-colors text-lg leading-none"
        @click="emit('close')"
        title="Close"
      >
        ×
      </button>
    </div>

    <!-- Direction display -->
    <div class="flex items-center gap-2 font-mono text-sm">
      <span class="text-zinc-300">{{ edge.source }}</span>
      <span class="text-zinc-500">{{ edge.isBidirectional ? '↔' : '→' }}</span>
      <span class="text-zinc-300">{{ edge.target }}</span>
    </div>

    <div v-if="edge.isBidirectional" class="text-[10px] text-zinc-500">
      Bidirectional — both directions exist
    </div>

    <!-- Actions -->
    <div class="space-y-2">
      <button
        class="w-full text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-200 rounded px-3 py-1.5 transition-colors text-left flex items-center gap-2"
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
