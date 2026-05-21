<script setup lang="ts">
import { inject, onMounted, onUnmounted, type Ref } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{ class?: string }>()
const open = inject<Ref<boolean>>('dialogOpen')!

function close() { open.value = false }

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKeyDown))
onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="fixed inset-0 bg-black/20 backdrop-blur-md" @click="close" />
      <div
        :class="cn('relative z-50 grid w-full max-w-md gap-4 rounded-lg border border-border bg-background p-6 shadow-lg mx-4', props.class)"
        role="dialog"
        aria-modal="true"
      >
        <slot />
      </div>
    </div>
  </Teleport>
</template>
