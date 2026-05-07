<script setup lang="ts">
import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'
import TextBlock from './TextBlock.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolUseBlock from './ToolUseBlock.vue'
import ToolResultBlock from './ToolResultBlock.vue'
import UnknownBlock from './UnknownBlock.vue'
import { formatTimestamp, shortModel } from '@/lib/format'
import { computed } from 'vue'
import { type VerbosityState, DEFAULT_VERBOSITY_STATE, isBlockVisible } from '@/lib/verbosity'

const props = defineProps<{
  event: TranscriptEvent
  verbosityState?: VerbosityState
}>()

const state = computed(() => props.verbosityState ?? DEFAULT_VERBOSITY_STATE)

// user-role events whose content is entirely tool_result blocks are injected
// by Claude Code after a tool runs — not messages authored by the human.
const isToolResultOnly = computed(
  () =>
    props.event.role === 'user' &&
    props.event.content.length > 0 &&
    props.event.content.every((b) => b.type === 'tool_result'),
)

const isUser = computed(
  () => props.event.role === 'user' && !isToolResultOnly.value,
)

const roleLabel = computed(() => {
  if (isToolResultOnly.value) return ''
  if (props.event.role === 'user') return 'You'
  if (props.event.role === 'assistant') return 'Assistant'
  return props.event.role ?? 'unknown'
})

const visibleContent = computed(() =>
  props.event.content.filter((b) => isBlockVisible(b, state.value)),
)

// Hidden tool_use blocks within this event — shown as a quiet inline indicator
// so the user knows tool activity occurred without the full call noise.
const hiddenToolUseCount = computed(
  () =>
    props.event.content.filter(
      (b) => b.type === 'tool_use' && !isBlockVisible(b, state.value),
    ).length,
)

function blockComponent(block: ContentBlock) {
  switch (block.type) {
    case 'text':
      return TextBlock
    case 'thinking':
      return ThinkingBlock
    case 'tool_use':
      return ToolUseBlock
    case 'tool_result':
      return ToolResultBlock
    default:
      return UnknownBlock
  }
}
</script>

<template>
  <div
    v-if="event.systemSubtype === 'interrupted'"
    class="flex items-center gap-3 text-xs text-destructive/60 select-none py-1"
  >
    <span class="flex-1 border-t border-destructive/20" />
    <span>Interrupted</span>
    <span class="flex-1 border-t border-destructive/20" />
  </div>
  <div
    v-else-if="isToolResultOnly"
    class="pl-4 border-l-2 border-border/60 ml-2 space-y-2"
  >
    <component
      :is="blockComponent(block)"
      v-for="(block, i) in visibleContent"
      :key="i"
      :block="block"
    />
  </div>
  <article
    v-else
    class="rounded-lg border border-border p-4 content-auto"
    :class="isUser ? 'bg-accent/20' : 'bg-card'"
  >
    <header class="flex items-center gap-2 text-xs text-muted-foreground mb-2">
      <span class="font-medium text-foreground">{{ roleLabel }}</span>
      <span v-if="shortModel(event.model)" class="font-mono">
        {{ shortModel(event.model) }}
      </span>
      <span class="ml-auto tabular-nums">
        {{ formatTimestamp(event.timestamp) }}
      </span>
    </header>
    <div class="space-y-2">
      <component
        :is="blockComponent(block)"
        v-for="(block, i) in visibleContent"
        :key="i"
        :block="block"
      />
      <div
        v-if="hiddenToolUseCount > 0"
        class="text-xs text-muted-foreground/50 font-mono pt-1 select-none"
      >
        · {{ hiddenToolUseCount }} tool {{ hiddenToolUseCount === 1 ? 'call' : 'calls' }} ·
      </div>
    </div>
  </article>
</template>
