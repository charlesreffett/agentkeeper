<script setup lang="ts">
import type { AccordionContentProps } from 'reka-ui'
import { AccordionContent } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<AccordionContentProps & { class?: string }>()
</script>

<template>
  <AccordionContent v-bind="props" :class="cn('overflow-hidden', props.class)">
    <slot />
  </AccordionContent>
</template>
