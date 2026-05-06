<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'
import { Comark } from '@comark/vue'
import { transcriptPlugins } from '@/lib/comark-config'

defineProps<{ block: Extract<ContentBlock, { type: 'text' }> }>()
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none select-text text-sm">
    <span v-if="block.partial" class="whitespace-pre-wrap break-words">{{ block.text }}</span>
    <Suspense v-else>
      <Comark :markdown="block.text" :plugins="transcriptPlugins" />
      <template #fallback>
        <span class="whitespace-pre-wrap break-words">{{ block.text }}</span>
      </template>
    </Suspense>
  </div>
</template>
