<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'
import { Comark } from '@comark/vue'
import { transcriptPlugins } from '@/lib/comark-config'

defineProps<{
  block: Extract<ContentBlock, { type: 'thinking' }>
  streaming?: boolean
}>()
</script>

<template>
  <div
    v-if="block.thinking.trim()"
    class="border-l-2 border-amber-400/50 pl-3 py-0.5 space-y-1.5"
  >
    <div class="flex items-center gap-1 text-[10px] font-semibold tracking-widest uppercase text-amber-500/80 select-none">
      <span>✧</span>
      <span>Thinking</span>
    </div>
    <div class="text-sm italic text-muted-foreground/80 select-text leading-relaxed">
      <Suspense>
        <Comark :markdown="block.thinking" :plugins="transcriptPlugins" :streaming="streaming ?? false" />
        <template #fallback>
          <span class="whitespace-pre-wrap break-words">{{ block.thinking }}</span>
        </template>
      </Suspense>
    </div>
  </div>
</template>
