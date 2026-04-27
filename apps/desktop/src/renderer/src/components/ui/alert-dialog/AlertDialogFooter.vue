<script setup lang="ts">
import { cn } from '@/lib/utils'
const props = defineProps<{ class?: string }>()
</script>

<template>
  <div :class="cn('flex flex-row justify-end gap-2 mt-2', props.class)">
    <slot />
  </div>
</template>
