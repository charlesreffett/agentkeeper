<script setup lang="ts">
import { RouterView } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import RightPanel from '@/components/RightPanel.vue'
import { useLayoutStore } from '@/stores/layout'
import { useProjectsStore } from '@/stores/projects'

const layoutStore = useLayoutStore()
const projectsStore = useProjectsStore()
</script>

<template>
  <div class="h-screen w-screen bg-background text-foreground overflow-hidden flex flex-col">
    <AppHeader />
    <div class="flex flex-1 min-h-0 overflow-hidden">
      <Sidebar />
      <div class="flex-1 min-w-0 overflow-hidden">
        <RouterView />
      </div>
      <RightPanel
        v-if="layoutStore.rightPanelOpen"
        :project-path="projectsStore.focusedProject?.path ?? ''"
      />
    </div>
  </div>
</template>
