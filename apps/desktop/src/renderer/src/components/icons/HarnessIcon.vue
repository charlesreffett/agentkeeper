<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  harnessId: string
  harnessName: string
  decorative?: boolean
}>()

const normalizedHarness = computed(() => `${props.harnessId} ${props.harnessName}`.toLowerCase())

const icon = computed(() => {
  const harness = normalizedHarness.value
  if (harness.includes('claude')) return 'simple-icons:claude'
  if (harness.includes('opencode')) return 'simple-icons:opencode'
  if (harness.includes('codex') || harness.includes('openai')) return 'simple-icons:openai'
  if (harness.includes('cursor')) return 'simple-icons:cursor'
  if (harness.includes('grok')) return 'simple-icons:x'
  return 'lucide:bot'
})

const colorClass = computed(() => {
  const harness = normalizedHarness.value
  if (harness.includes('claude')) return 'text-[#d97757]'
  if (harness.includes('opencode')) return 'text-[#211e1e] dark:text-[#f1ecec]'
  if (harness.includes('cursor')) return 'text-[#26251e] dark:text-[#edecec]'
  if (harness.includes('grok')) return 'text-[#0f0f0f] dark:text-[#f5f5f5]'
  if (harness.includes('codex') || harness.includes('openai')) return 'text-black dark:text-white'
  return 'text-current'
})
</script>

<template>
  <Icon
    :icon="icon"
    :role="decorative ? undefined : 'img'"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="decorative ? undefined : harnessName"
    :class="colorClass"
  />
</template>
