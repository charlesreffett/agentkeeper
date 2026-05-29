<template>
  <div
    class="relative rounded-lg border-2 px-4 py-3 bg-card shadow-md min-w-[120px] cursor-pointer select-none transition-all"
    :class="[
      selected ? 'border-blue-500 shadow-blue-500/20' : 'border-border hover:border-foreground/40',
      data.isEntryPoint ? 'ring-2 ring-amber-500/60' : '',
      data.anyToAny ? 'border-dashed' : '',
    ]"
  >
    <Handle id="top" type="source" :position="Position.Top" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />
    <Handle id="left" type="source" :position="Position.Left" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />
    <Handle id="bottom" type="source" :position="Position.Bottom" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />

    <!-- Role label -->
    <div class="text-sm font-semibold text-card-foreground pr-5">{{ data.label }}</div>

    <!-- Badges row -->
    <div class="mt-1 flex items-center gap-1.5 flex-wrap">
      <span
        v-if="data.isEntryPoint"
        class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30"
      >
        entry
      </span>
      <span
        v-if="data.multiplicityLabel && !data.isExpanded"
        class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
      >
        {{ data.multiplicityLabel }}
      </span>
      <span
        v-if="data.anyToAny"
        class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30"
      >
        open
      </span>
    </div>

    <!-- Expand / collapse toggle — top-right corner, only on multi-instance roles -->
    <button
      v-if="data.isExpandable"
      class="absolute top-1.5 right-1.5 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      :title="data.isExpanded ? 'Collapse instances' : 'Expand instances'"
      @click.stop="data.onToggleExpand?.()"
    >
      <!-- Collapse icon (contract arrows) when expanded -->
      <svg v-if="data.isExpanded" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M8 3v3a2 2 0 0 1-2 2H3" />
        <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
        <path d="M3 16h3a2 2 0 0 1 2 2v3" />
        <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
      </svg>
      <!-- Expand icon (grid) when collapsed -->
      <svg v-else class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    </button>

    <Handle id="right" type="source" :position="Position.Right" class="!bg-background !border-2 !border-border !w-3 !h-3 hover:!border-primary hover:!bg-primary/10" />
  </div>
</template>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'

defineProps<{
  data: {
    label: string
    isEntryPoint: boolean
    anyToAny: boolean
    multiplicityLabel: string
    isExpandable: boolean
    isExpanded: boolean
    onToggleExpand?: () => void
  }
  selected: boolean
}>()
</script>
