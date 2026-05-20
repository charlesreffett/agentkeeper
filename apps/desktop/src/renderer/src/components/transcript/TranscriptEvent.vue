<script setup lang="ts">
import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'
import TextBlock from './TextBlock.vue'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolUseBlock from './ToolUseBlock.vue'
import ToolResultBlock from './ToolResultBlock.vue'
import ImageBlock from './ImageBlock.vue'
import UnknownBlock from './UnknownBlock.vue'
import { CornerDownRight, Info } from 'lucide-vue-next'
import { formatTimestamp, shortModel } from '@/lib/format'
import { computed } from 'vue'
import { type VerbosityState, DEFAULT_VERBOSITY_STATE, isBlockVisible } from '@/lib/verbosity'

const props = defineProps<{
  event: TranscriptEvent
  verbosityState?: VerbosityState
  /** Display name for the agent that produced this event. Used for sub-agent progress events. */
  agentName?: string | null
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

// progress events carry sub-agent activity streams.
const isSubAgent = computed(() => props.event.kind === 'progress')

// Injected opening prompt of a sub-agent session — distinct from both user
// messages and generic system info bars.
const isDelegatedTask = computed(
  () => props.event.systemSubtype === 'delegated-task',
)

// Non-interrupted, non-delegated system events render as slim info bars.
const isSystemBar = computed(
  () =>
    props.event.kind === 'system' &&
    props.event.systemSubtype !== 'interrupted' &&
    props.event.systemSubtype !== 'delegated-task',
)

const displayName = computed(() => {
  if (isToolResultOnly.value) return ''
  if (isUser.value) return 'you'
  if (isSubAgent.value) return props.agentName ?? 'agent'
  return props.agentName ?? 'Claude'
})

const visibleContent = computed(() =>
  props.event.content.filter((b) => isBlockVisible(b, state.value)),
)

type BlockGroup =
  | { kind: 'single'; block: ContentBlock }
  | { kind: 'images'; blocks: (ContentBlock & { type: 'image' })[] }

const groupedContent = computed((): BlockGroup[] => {
  const groups: BlockGroup[] = []
  for (const block of visibleContent.value) {
    if (block.type === 'image') {
      const last = groups[groups.length - 1]
      if (last?.kind === 'images') {
        last.blocks.push(block as ContentBlock & { type: 'image' })
      } else {
        groups.push({ kind: 'images', blocks: [block as ContentBlock & { type: 'image' }] })
      }
    } else {
      groups.push({ kind: 'single', block })
    }
  }
  return groups
})

// Hidden tool_use blocks within this event — shown as a quiet inline indicator.
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
    case 'image':
      return ImageBlock
    default:
      return UnknownBlock
  }
}
</script>

<template>
  <!-- ── Interrupted divider ─────────────────────────────────────────────── -->
  <div
    v-if="event.systemSubtype === 'interrupted'"
    class="flex items-center gap-3 text-xs text-destructive/60 select-none py-1"
  >
    <span class="flex-1 border-t border-destructive/20" />
    <span>Interrupted</span>
    <span class="flex-1 border-t border-destructive/20" />
  </div>

  <!-- ── System info bar ─────────────────────────────────────────────────── -->
  <div
    v-else-if="isSystemBar"
    class="flex items-center gap-2 text-xs text-muted-foreground/60 bg-muted/20 rounded-md px-3 py-1.5 select-none"
  >
    <Info class="size-3 shrink-0 text-muted-foreground/40" />
    <!-- Render raw text inline to avoid block elements inside the bar -->
    <span class="italic truncate min-w-0 select-text">
      {{
        event.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as Extract<typeof b, { type: 'text' }>).text)
          .join(' ')
      }}
    </span>
    <span class="ml-auto tabular-nums shrink-0">
      {{ formatTimestamp(event.timestamp) }}
    </span>
  </div>

  <!-- ── Delegated task brief ──────────────────────────────────────────── -->
  <div
    v-else-if="isDelegatedTask"
    class="border-l-2 border-violet-500/40 bg-violet-500/5 rounded-r-md px-3 py-2 space-y-1.5"
  >
    <header class="flex items-center gap-1.5 text-xs select-none">
      <CornerDownRight class="size-3 shrink-0 text-violet-400/70" />
      <span class="font-medium text-violet-400/70">delegated task</span>
      <span class="ml-auto tabular-nums text-muted-foreground/50">
        {{ formatTimestamp(event.timestamp) }}
      </span>
    </header>
    <div class="space-y-1 text-sm text-foreground/70 select-text">
      <template v-for="(group, i) in groupedContent" :key="i">
        <component
          v-if="group.kind === 'single' && group.block.type === 'text'"
          :is="blockComponent(group.block)"
          :block="group.block"
        />
      </template>
    </div>
  </div>

  <!-- ── Tool-result continuation (no avatar) ───────────────────────────── -->
  <div
    v-else-if="isToolResultOnly"
    class="ml-10 space-y-1.5"
  >
    <template v-for="(group, i) in groupedContent" :key="i">
      <div v-if="group.kind === 'images'" class="flex flex-wrap gap-2">
        <ImageBlock
          v-for="(block, j) in group.blocks"
          :key="j"
          :block="block"
        />
      </div>
      <component
        v-else
        :is="blockComponent(group.block)"
        :block="group.block"
      />
    </template>
  </div>

  <!-- ── Normal user / assistant message ────────────────────────────────── -->
  <article v-else class="flex gap-3">
    <!-- Avatar -->
    <div
      class="mt-0.5 size-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-bold text-white select-none"
      :class="isUser ? 'bg-blue-500' : 'bg-orange-400'"
    >
      {{ isUser ? 'Y' : 'C' }}
    </div>

    <!-- Content column -->
    <div class="flex-1 min-w-0 space-y-2">
      <!-- Header row: name · sub-agent badge · model · timestamp -->
      <header class="flex items-center gap-2 text-xs text-muted-foreground leading-none">
        <span class="font-medium text-foreground">{{ displayName }}</span>
        <!-- Sub-agent badge -->
        <span
          v-if="isSubAgent"
          class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20"
        >
          sub-agent
        </span>
        <span v-if="shortModel(event.model)" class="font-mono text-muted-foreground/60">
          {{ shortModel(event.model) }}
        </span>
        <span class="ml-auto tabular-nums text-muted-foreground/50">
          {{ formatTimestamp(event.timestamp) }}
        </span>
      </header>

      <!-- Blocks -->
      <div class="space-y-2">
        <template v-for="(group, i) in groupedContent" :key="i">
          <div v-if="group.kind === 'images'" class="flex flex-wrap gap-2">
            <ImageBlock
              v-for="(block, j) in group.blocks"
              :key="j"
              :block="block"
            />
          </div>
          <component
            v-else
            :is="blockComponent(group.block)"
            :block="group.block"
          />
        </template>
        <!-- Hidden tool call hint -->
        <div
          v-if="hiddenToolUseCount > 0"
          class="text-xs text-muted-foreground/40 font-mono select-none"
        >
          · {{ hiddenToolUseCount }} tool {{ hiddenToolUseCount === 1 ? 'call' : 'calls' }} ·
        </div>
      </div>
    </div>
  </article>
</template>
