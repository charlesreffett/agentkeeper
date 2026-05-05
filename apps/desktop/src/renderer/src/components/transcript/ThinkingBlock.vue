<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'
import { Comark } from '@comark/vue'

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
    <div class="mt-2 select-text prose prose-xs dark:prose-invert max-w-none">
      <Suspense>
        <Comark :markdown="block.thinking" />
        <template #fallback>
          <span class="whitespace-pre-wrap break-words">{{ block.thinking }}</span>
        </template>
      </Suspense>
    </div>
  </details>
</template>
