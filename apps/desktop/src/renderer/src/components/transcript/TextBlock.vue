<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'

defineProps<{ block: Extract<ContentBlock, { type: 'text' }> }>()
</script>

<template>
  <div
    class="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans select-text"
  >
    {{ block.text }}
  </div>
</template>
