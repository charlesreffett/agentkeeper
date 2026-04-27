<script setup lang="ts">
import { onMounted } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
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
  <AppLayout />
</template>
