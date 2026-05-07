<script setup lang="ts">
import type { ContentBlock } from '@shared/ipc-contract'

const props = defineProps<{
  block: ContentBlock & { type: 'image' }
}>()

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
    class="max-w-full max-h-64 rounded border border-border object-contain"
    alt="Attached image"
  />
</template>
