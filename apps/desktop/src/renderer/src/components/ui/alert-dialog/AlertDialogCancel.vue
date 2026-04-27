<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
const open = inject<Ref<boolean>>('alertDialogOpen')!
</script>

<template>
  <button
    :class="cn('inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring', props.class)"
    @click="open = false"
  >
    <slot />
  </button>
</template>
