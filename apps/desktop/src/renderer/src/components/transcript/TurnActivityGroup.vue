<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ChevronRight, Loader2 } from '@/components/icons/app-icons'
import type { WorkTurn } from '@/lib/transcriptGrouping'
import ActivityGroup from './ActivityGroup.vue'
import TextBlock from './TextBlock.vue'
import ThinkingBlock from './ThinkingBlock.vue'

const props = defineProps<{
  turn: WorkTurn
  active?: boolean
  liveStartedAt?: number | null
  liveEndedAt?: number | null
  streaming?: boolean
}>()

const expanded = ref(props.active ?? false)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
watch(() => props.active, (active) => {
  expanded.value = active ?? false
  if (active && !timer) timer = setInterval(() => { now.value = Date.now() }, 1000)
  else if (!active && timer) { clearInterval(timer); timer = null }
}, { immediate: true })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`
}

const elapsed = computed(() => {
  const start = props.liveStartedAt ?? props.turn.startedAt
  const end = props.active ? now.value : (props.liveEndedAt ?? props.turn.endedAt)
  return start && end && end >= start ? duration(end - start) : null
})
const label = computed(() => `${props.active ? 'Working' : 'Worked'}${elapsed.value ? ` for ${elapsed.value}` : ''}`)
</script>

<template>
  <section class="mb-[15px]">
    <button
      type="button"
      class="w-full cursor-pointer select-none flex items-center gap-2 border-b border-border/50 py-1.5 text-sm text-muted-foreground hover:text-foreground"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <Loader2 v-if="active" class="size-3.5 animate-spin" />
      <span>{{ label }}</span>
      <ChevronRight class="size-3.5 transition-transform duration-150" :class="expanded ? 'rotate-90' : ''" />
    </button>
    <div
      class="grid transition-[grid-template-rows,opacity] duration-150 ease-out"
      :class="expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'"
    >
      <div class="overflow-hidden">
        <div class="pt-3 space-y-4">
          <section v-for="phase in turn.phases" :key="phase.id" class="space-y-2">
            <template v-for="(entry, index) in phase.narrative" :key="`${entry.event.uuid}-${index}`">
              <ThinkingBlock v-if="entry.block.type === 'thinking'" :block="entry.block" :streaming="streaming" />
              <TextBlock v-else :block="entry.block" :streaming="streaming" />
            </template>
            <ActivityGroup v-for="group in phase.groups" :key="group.id" :group="group" />
          </section>
        </div>
      </div>
    </div>
  </section>
</template>
