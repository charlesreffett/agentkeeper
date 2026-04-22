<script setup lang="ts">
import { ref } from 'vue'
import Welcome from './views/Welcome.vue'
import ProjectHome from './views/ProjectHome.vue'
import type { RecentProject } from '@shared/ipc-contract'

const currentProject = ref<RecentProject | null>(null)

function openProject(project: RecentProject) {
  currentProject.value = project
}

function closeProject() {
  currentProject.value = null
}
</script>

<template>
  <div class="h-screen w-screen bg-background text-foreground overflow-hidden">
    <ProjectHome
      v-if="currentProject"
      :project="currentProject"
      @close="closeProject"
    />
    <Welcome v-else @open="openProject" />
  </div>
</template>
