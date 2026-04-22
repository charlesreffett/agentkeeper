<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'

defineProps<{ block: Extract<ContentBlock, { type: 'thinking' }> }>()
</script>

<template>
  <details
    v-if="block.thinking.trim()"
    class="border-l-2 border-muted pl-3 text-xs text-muted-foreground"
  >
    <summary class="cursor-pointer select-none hover:text-foreground transition">
      Thinking
    </summary>
    <div class="mt-2 whitespace-pre-wrap break-words select-text">
      {{ block.thinking }}
    </div>
  </details>
</template>
