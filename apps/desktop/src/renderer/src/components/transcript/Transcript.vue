<script setup lang="ts">
import { computed } from 'vue'
import type { TranscriptEvent } from '@shared/ipc-contract'
import TranscriptEventView from './TranscriptEvent.vue'
import {
  type VerbosityState,
  DEFAULT_VERBOSITY_STATE,
  isBlockVisible,
  passesEventFilter,
  hiddenToolCount,
} from '@/lib/verbosity'

const props = defineProps<{
  events: TranscriptEvent[]
  verbosityState?: VerbosityState
  roleName?: string | null
}>()

const emit = defineEmits<{ 'show-all': [] }>()

const state = computed(() => props.verbosityState ?? DEFAULT_VERBOSITY_STATE)

type RenderItem =
  | { type: 'event'; event: TranscriptEvent }
  | { type: 'gap'; count: number }

const renderItems = computed((): RenderItem[] => {
  const items: RenderItem[] = []
  let pendingGap = 0

  for (const event of props.events) {
    if (!passesEventFilter(event, state.value)) continue

    const hasVisibleBlock = event.content.some((b) => isBlockVisible(b, state.value))

    if (!hasVisibleBlock) {
      // Entire event hidden by block filters — accumulate hidden tool interactions.
      pendingGap += hiddenToolCount(event.content, state.value)
      continue
    }

    if (pendingGap > 0) {
      items.push({ type: 'gap', count: pendingGap })
      pendingGap = 0
    }

    items.push({ type: 'event', event })
  }
  // Trailing hidden events don't get a gap pill — nothing to separate them from.

  return items
})

const hasVisibleContent = computed(() => renderItems.value.length > 0)
</script>

<template>
  <div class="px-6 py-6 max-w-4xl mx-auto space-y-5">

    <!-- Empty state: events exist but all hidden by current verbosity -->
    <div
      v-if="!hasVisibleContent && events.length > 0"
      class="flex flex-col items-center justify-center gap-3 py-20 text-center"
    >
      <p class="text-sm text-muted-foreground">
        All messages are hidden by current verbosity.
      </p>
      <button
        class="text-xs text-muted-foreground/60 hover:text-foreground border border-border/40 hover:border-border rounded px-3 py-1 transition-colors"
        @click="emit('show-all')"
      >
        Show all
      </button>
    </div>

    <!-- Event list -->
    <template
      v-for="(item, i) in renderItems"
      :key="item.type === 'event' ? item.event.uuid : `gap-${i}`"
    >
      <div
        v-if="item.type === 'gap'"
        class="flex items-center gap-2 text-xs text-muted-foreground/50 select-none py-0.5"
      >
        <span class="flex-1 border-t border-border/25" />
        <span class="font-mono">
          {{ item.count }} tool {{ item.count === 1 ? 'call' : 'calls' }}
        </span>
        <span class="flex-1 border-t border-border/25" />
      </div>
      <TranscriptEventView
        v-else
        :event="item.event"
        :verbosity-state="state"
        :agent-name="roleName ?? undefined"
      />
    </template>
  </div>
</template>
