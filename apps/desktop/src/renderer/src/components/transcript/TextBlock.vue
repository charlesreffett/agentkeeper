<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'
import { Comark } from '@comark/vue'
import { transcriptComponents, transcriptPlugins } from '@/lib/comark-config'

defineProps<{
  block: Extract<ContentBlock, { type: 'text' }>
  streaming?: boolean
}>()
</script>

<template>
  <div class="prose prose-sm dark:prose-invert max-w-none select-text text-sm">
    <Suspense>
      <Comark :markdown="block.text" :plugins="transcriptPlugins" :components="transcriptComponents" :streaming="streaming ?? false" />
      <template #fallback>
        <span class="whitespace-pre-wrap break-words">{{ block.text }}</span>
      </template>
    </Suspense>
  </div>
</template>
