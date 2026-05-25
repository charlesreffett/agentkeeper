<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import AppLayout from '@/components/AppLayout.vue'
import { Toaster } from '@/components/ui/sonner'
import QueryDevtools from '@/components/QueryDevtools.vue'
import { useLayoutStore } from '@/stores/layout'
import { queryKeys } from '@/lib/queryKeys'

const isDev = import.meta.env.DEV

const layoutStore = useLayoutStore()
const queryClient = useQueryClient()

let cleanupOpenFile: (() => void) | null = null

onMounted(async () => {
  const settings = await window.agentkeeper.settings.get()
  layoutStore.initTheme(settings.theme ?? 'dark')

  // Global handler: install .akp files opened via Finder or second-instance argv
  cleanupOpenFile = window.agentkeeper.plugins.onOpenFile(async (filePath) => {
    try {
      await window.agentkeeper.plugins.install(filePath)
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all })
    } catch (e) {
      console.error('[plugins] open-file install failed', e)
    }
  })
})

onUnmounted(() => {
  cleanupOpenFile?.()
})
</script>

<template>
  <AppLayout />
  <Toaster :theme="layoutStore.theme" />
  <QueryDevtools v-if="isDev" />
</template>
