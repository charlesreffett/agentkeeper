<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
const emit = defineEmits<{ click: [] }>()
const open = inject<Ref<boolean>>('alertDialogOpen')!

function onClick() {
  open.value = false
  emit('click')
}
</script>

<template>
  <button
    :class="cn('inline-flex items-center justify-center rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground shadow-sm hover:bg-destructive/90 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring', props.class)"
    @click="onClick"
  >
    <slot />
  </button>
</template>
