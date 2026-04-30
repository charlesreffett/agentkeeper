<script setup lang="ts">
import type { SlashCommand } from '@shared/ipc-contract'

defineProps<{
  suggestions: SlashCommand[]
  selectedIndex: number
}>()

const emit = defineEmits<{
  select: [cmd: SlashCommand]
  close: []
}>()
</script>

<template>
  <div
    class="absolute bottom-full left-0 right-0 mb-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden"
  >
    <ul class="max-h-48 overflow-y-auto py-1">
      <li
        v-for="(cmd, i) in suggestions"
        :key="cmd.id"
        class="flex items-baseline gap-2 px-3 py-1.5 cursor-pointer text-sm transition-colors"
        :class="i === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'"
        @mousedown.prevent="emit('select', cmd)"
      >
        <span class="font-mono text-xs text-primary shrink-0">/{{ cmd.id }}</span>
        <span class="text-muted-foreground truncate flex-1">{{ cmd.name }}</span>
        <span v-if="cmd.scope === 'agent'" class="text-[10px] text-muted-foreground/60 shrink-0 italic">built-in</span>
      </li>
    </ul>
    <div
      class="px-3 py-1.5 border-t border-border/60 text-[10px] text-muted-foreground flex gap-3"
    >
      <span>↑↓ Navigate</span>
      <span>↵ Select</span>
      <span>Click to pick</span>
    </div>
  </div>
</template>
