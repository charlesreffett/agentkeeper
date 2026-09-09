<script setup lang="ts">
import type { AccordionTriggerProps } from 'reka-ui'
import { AccordionHeader, AccordionTrigger } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<AccordionTriggerProps & { class?: string }>()
</script>

<template>
  <AccordionHeader class="flex">
    <AccordionTrigger v-bind="props" :class="cn('flex flex-1 items-center', props.class)">
      <slot />
    </AccordionTrigger>
  </AccordionHeader>
</template>
