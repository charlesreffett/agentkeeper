<template>
  <div
    class="relative rounded-md border border-dashed px-3 py-2 bg-card/60 shadow-sm min-w-[110px] cursor-pointer select-none transition-all"
    :class="[
      selected ? 'border-blue-500 shadow-blue-500/20' : 'border-border/70 hover:border-foreground/30',
      data.isEntryPoint ? 'ring-1 ring-amber-500/50' : '',
    ]"
  >
    <Handle type="target" :position="Position.Left" class="!bg-sky-400 !border-sky-600 !w-3 !h-3" />

    <!-- Instance label -->
    <div class="text-xs font-medium text-card-foreground/80">{{ data.label }}</div>

    <!-- Entry badge -->
    <div v-if="data.isEntryPoint" class="mt-0.5">
      <span class="text-[9px] font-medium px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
        entry
      </span>
    </div>

    <!-- Collapse trigger — bottom-right corner -->
    <button
      v-if="data.onCollapse"
      class="absolute bottom-1 right-1 p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/40 transition-colors"
      title="Collapse instances"
      @click.stop="data.onCollapse()"
    >
      <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
    </button>

    <Handle type="source" :position="Position.Right" class="!bg-amber-400 !border-amber-600 !w-3 !h-3" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: {
    label: string
    isEntryPoint: boolean
    onCollapse?: () => void
  }
  selected: boolean
}>()
</script>
