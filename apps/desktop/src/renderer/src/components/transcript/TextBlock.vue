<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'
import { Comark } from '@comark/vue'

defineProps<{ block: Extract<ContentBlock, { type: 'text' }> }>()
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none select-text text-sm">
    <Suspense>
      <Comark :markdown="block.text" />
      <template #fallback>
        <span class="whitespace-pre-wrap break-words">{{ block.text }}</span>
      </template>
    </Suspense>
  </div>
</template>
