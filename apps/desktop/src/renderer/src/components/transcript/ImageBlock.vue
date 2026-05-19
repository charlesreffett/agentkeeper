<script setup lang="ts">
import { inject } from 'vue'
import type { ContentBlock } from '@shared/ipc-contract'

const props = defineProps<{
  block: ContentBlock & { type: 'image' }
}>()

const openTranscriptLightbox = inject<((src: string) => void) | null>('openTranscriptLightbox', null)

const src = (() => {
  const source = props.block.source as Record<string, unknown> | undefined
  if (!source) return null
  if (source['type'] === 'base64') {
    return `data:${source['media_type']};base64,${source['data']}`
  }
  if (source['type'] === 'url') {
    return source['url'] as string
  }
  return null
})()
</script>

<template>
  <img
    v-if="src"
    :src="src"
    class="w-20 h-20 object-cover rounded border border-border cursor-pointer"
    alt="Attached image"
    @click="openTranscriptLightbox?.(src!)"
  />
</template>
