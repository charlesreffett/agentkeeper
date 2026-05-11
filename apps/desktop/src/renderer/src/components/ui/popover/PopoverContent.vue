<script setup lang="ts">
import { PopoverContent } from 'reka-ui'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: string
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}>()
</script>

<template>
  <PopoverContent
    :align="align ?? 'start'"
    :side="side"
    :side-offset="sideOffset ?? 4"
    :class="
      cn(
        'z-50 w-72 rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
        props.class,
      )
    "
  >
    <slot />
  </PopoverContent>
</template>
