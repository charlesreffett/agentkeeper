<template>
  <div
    class="relative rounded-lg border-2 px-4 py-3 bg-card shadow-md min-w-[120px] cursor-pointer select-none transition-all"
    :class="[
      selected ? 'border-blue-500 shadow-blue-500/20' : 'border-border hover:border-foreground/40',
      data.isEntryPoint ? 'ring-2 ring-amber-500/60' : '',
      data.anyToAny ? 'border-dashed' : '',
    ]"
  >
    <!-- Target handle — pointer-events-none so drags can only START from source
         handles. Vue Flow's proximity-based drop detection still registers
         connections dropped here correctly. -->
    <Handle type="target" :position="Position.Left" class="!bg-blue-500 !border-blue-700 !w-3 !h-3 !pointer-events-none" />

    <!-- Role label -->
    <div class="text-sm font-semibold text-card-foreground">{{ data.label }}</div>

    <!-- Badges row -->
    <div class="mt-1 flex items-center gap-1.5 flex-wrap">
      <span
        v-if="data.isEntryPoint"
        class="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30"
      >
        entry
      </span>
      <span
        v-if="data.multiplicityLabel"
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

    <!-- Source handle -->
    <Handle type="source" :position="Position.Right" class="!bg-blue-500 !border-blue-700 !w-3 !h-3" />
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
  }
  selected: boolean
}>()
</script>
