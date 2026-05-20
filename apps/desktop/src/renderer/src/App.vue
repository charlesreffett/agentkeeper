<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import AppLayout from '@/components/AppLayout.vue'
import { Toaster } from '@/components/ui/sonner'
import QueryDevtools from '@/components/QueryDevtools.vue'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { useLayoutStore } from '@/stores/layout'
import { queryKeys } from '@/lib/queryKeys'

const isDev = import.meta.env.DEV

const uiStore = useUIContributionsStore()
const layoutStore = useLayoutStore()
const queryClient = useQueryClient()

let cleanupOpenFile: (() => void) | null = null

onMounted(async () => {
  const settings = await window.agentkeeper.settings.get()
  layoutStore.initTheme(settings.theme ?? 'dark')
  uiStore.contribute('sidebar.primary', {
    id: 'jira',
    label: 'Jira',
    icon: 'Layers',
    order: 10,
    component: null,
  })
  uiStore.contribute('sidebar.primary', {
    id: 'github',
    label: 'GitHub',
    icon: 'GitPullRequest',
    order: 20,
    component: null,
  })

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
