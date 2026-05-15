<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useQueryClient, onlineManager } from '@tanstack/vue-query'
import { TanstackQueryDevtools } from '@tanstack/query-devtools'

const client = useQueryClient()
const container = ref<HTMLDivElement | null>(null)
let devtools: TanstackQueryDevtools | null = null

onMounted(() => {
  if (!container.value) return
  devtools = new TanstackQueryDevtools({
    client,
    queryFlavor: 'Vue Query',
    version: '5',
    onlineManager,
  })
  devtools.mount(container.value)
})

onUnmounted(() => {
  devtools?.unmount()
})
</script>

<template>
  <div ref="container" />
</template>
