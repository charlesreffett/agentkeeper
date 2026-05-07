<script setup lang="ts">
import { Share2, Sparkles, Terminal, Wrench } from 'lucide-vue-next'
import { type VerbosityMode, type VerbosityState, MODE_DEFAULTS } from '@/lib/verbosity'

const props = defineProps<{
  modelValue: VerbosityState
  hiddenCount: number
}>()

const emit = defineEmits<{ 'update:modelValue': [value: VerbosityState] }>()

const MODES: { value: VerbosityMode; label: string }[] = [
  { value: 'concise', label: 'Concise' },
  { value: 'default', label: 'Default' },
  { value: 'verbose', label: 'Verbose' },
]

function setMode(mode: VerbosityMode) {
  emit('update:modelValue', { mode, toggles: { ...MODE_DEFAULTS[mode] } })
}

function toggleChip(key: keyof VerbosityState['toggles']) {
  emit('update:modelValue', {
    ...props.modelValue,
    toggles: { ...props.modelValue.toggles, [key]: !props.modelValue.toggles[key] },
  })
}
</script>

<template>
  <div class="flex items-center gap-2.5 text-[11px] select-none min-w-0 flex-1">

    <!-- Mode segmented control -->
    <div class="flex rounded border border-border overflow-hidden shrink-0">
      <button
        v-for="m in MODES"
        :key="m.value"
        class="px-2.5 py-0.5 transition-colors"
        :class="
          modelValue.mode === m.value
            ? 'bg-muted text-foreground font-medium'
            : 'text-muted-foreground hover:bg-muted/40'
        "
        @click="setMode(m.value)"
      >
        {{ m.label }}
      </button>
    </div>

    <span class="border-l border-border/60 h-3 shrink-0" />

    <!-- Independent content-type toggles -->
    <div class="flex items-center gap-1 flex-wrap">
      <button
        class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors"
        :class="
          modelValue.toggles.toolCalls
            ? 'border-foreground/25 bg-muted text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground/70 hover:border-border/80'
        "
        @click="toggleChip('toolCalls')"
      >
        <Wrench class="size-2.5 shrink-0" />
        Tool calls
      </button>

      <button
        class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors"
        :class="
          modelValue.toggles.thinking
            ? 'border-foreground/25 bg-muted text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground/70 hover:border-border/80'
        "
        @click="toggleChip('thinking')"
      >
        <Sparkles class="size-2.5 shrink-0" />
        Thinking
      </button>

      <button
        class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors"
        :class="
          modelValue.toggles.system
            ? 'border-foreground/25 bg-muted text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground/70 hover:border-border/80'
        "
        @click="toggleChip('system')"
      >
        <Terminal class="size-2.5 shrink-0" />
        System
      </button>

      <button
        class="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 transition-colors"
        :class="
          modelValue.toggles.subAgents
            ? 'border-foreground/25 bg-muted text-foreground'
            : 'border-border text-muted-foreground hover:text-foreground/70 hover:border-border/80'
        "
        @click="toggleChip('subAgents')"
      >
        <Share2 class="size-2.5 shrink-0" />
        Sub-agents
      </button>
    </div>

    <!-- Hidden count — pushed to far right -->
    <span
      v-if="hiddenCount > 0"
      class="ml-auto shrink-0 tabular-nums text-muted-foreground/50"
    >
      {{ hiddenCount }} hidden
    </span>
  </div>
</template>
