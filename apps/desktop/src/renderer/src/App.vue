<script setup lang="ts">
import { onMounted } from 'vue'
import Sidebar from '@/components/Sidebar.vue'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { useProjectsStore } from '@/stores/projects'

const uiStore = useUIContributionsStore()
const projectsStore = useProjectsStore()

onMounted(() => {
  void projectsStore.load()
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
  <div class="h-screen w-screen bg-background text-foreground overflow-hidden flex">
    <Sidebar />
    <div class="flex-1 min-w-0 overflow-hidden">
      <RouterView />
    </div>
  </div>
</template>
