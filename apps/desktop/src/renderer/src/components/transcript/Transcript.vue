<script setup lang="ts">
import { computed } from 'vue'
import type { TranscriptEvent } from '@shared/ipc-contract'
import TranscriptEventView from './TranscriptEvent.vue'

const props = defineProps<{ events: TranscriptEvent[] }>()

const visibleEvents = computed(() =>
  props.events.filter((e) => {
    if (e.isMeta) return false
    if (e.kind === 'other') return false
    if (e.kind === 'summary') return false
    if (e.kind === 'system') return false
    // 'progress' events are subagent activity — collapse out for V1 simplicity.
    if (e.kind === 'progress') return false
    if (e.content.length === 0) return false
    return true
  }),
)
</script>

<template>
  <div class="px-6 py-6 max-w-4xl mx-auto space-y-4">
    <TranscriptEventView
      v-for="event in visibleEvents"
      :key="event.uuid"
      :event="event"
    />
  </div>
</template>
