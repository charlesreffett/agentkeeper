<script setup lang="ts">
import { onMounted } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { Toaster } from '@/components/ui/sonner'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { useProjectsStore } from '@/stores/projects'
import { useLayoutStore } from '@/stores/layout'

const uiStore = useUIContributionsStore()
const projectsStore = useProjectsStore()
const layoutStore = useLayoutStore()

onMounted(async () => {
  const [, settings] = await Promise.all([
    projectsStore.load(),
    window.agentkeeper.settings.get(),
  ])
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
})
</script>

<template>
  <AppLayout />
  <Toaster :theme="layoutStore.theme" />
</template>
