<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, FileText, Search, Terminal, Users, Wrench } from '@/components/icons/app-icons'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import type { ActivityGroup } from '@/lib/transcriptGrouping'
import { activityGroupLabel } from '@/lib/transcriptGrouping'
import ToolUseBlock from './ToolUseBlock.vue'
import ToolResultBlock from './ToolResultBlock.vue'
import UnknownBlock from './UnknownBlock.vue'

const props = defineProps<{ group: ActivityGroup }>()
const expanded = ref<string>()
const hasError = computed(() => props.group.items.some((item) => item.result?.is_error))
const icon = computed(() => ({
  files: FileText, commands: Terminal, searches: Search, agents: Users, system: Terminal, tools: Wrench,
})[props.group.category])

function eventLabel(item: ActivityGroup['items'][number]): string {
  const text = item.event.content
    .filter((block) => block.type === 'text' || block.type === 'thinking')
    .map((block) => block.type === 'text' ? block.text : block.thinking)
    .join(' ')
    .trim()
  return text || item.event.systemSubtype?.replaceAll('_', ' ') || (item.category === 'agents' ? 'Sub-agent activity' : 'System activity')
}
</script>

<template>
  <Accordion v-model="expanded" type="single" collapsible class="text-sm">
    <AccordionItem :value="group.id" class="border-0">
      <AccordionTrigger class="group/activity cursor-pointer select-none gap-2 py-1 text-muted-foreground hover:text-foreground">
        <component :is="icon" class="size-3.5 shrink-0" />
        <span>{{ activityGroupLabel(group) }}</span>
        <span v-if="hasError" class="text-destructive text-xs">· failed</span>
        <ChevronRight class="size-3 ml-0.5 transition-transform duration-150 group-data-[state=open]/activity:rotate-90" />
      </AccordionTrigger>
      <AccordionContent class="transcript-activity-content">
        <div class="ml-5 mt-1 space-y-2 max-h-80 overflow-y-auto overscroll-contain pr-2">
          <div v-for="item in group.items" :key="item.id" class="space-y-1.5">
            <template v-if="item.block.type === 'tool_use'">
              <ToolUseBlock :block="item.block" :status="item.result?.is_error ? 'error' : item.result ? 'success' : 'running'" />
              <ToolResultBlock v-if="item.result" :block="item.result" />
            </template>
            <div v-else-if="item.category === 'system' || item.category === 'agents'" class="rounded border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground whitespace-pre-wrap">
              {{ eventLabel(item) }}
            </div>
            <UnknownBlock v-else-if="item.block.type === 'unknown'" :block="item.block" />
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  </Accordion>
</template>

<style scoped>
.transcript-activity-content[data-state='open'] {
  animation: transcript-accordion-down 150ms ease-out;
}

.transcript-activity-content[data-state='closed'] {
  animation: transcript-accordion-up 150ms ease-out;
}

@keyframes transcript-accordion-down {
  from { height: 0; opacity: 0; }
  to { height: var(--reka-accordion-content-height); opacity: 1; }
}

@keyframes transcript-accordion-up {
  from { height: var(--reka-accordion-content-height); opacity: 1; }
  to { height: 0; opacity: 0; }
}
</style>
