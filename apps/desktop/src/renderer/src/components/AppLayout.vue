<script setup lang="ts">
import { RouterView } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import RightPanel from '@/components/RightPanel.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useLayoutStore } from '@/stores/layout'
import { useProjectsStore } from '@/stores/projects'

const layoutStore = useLayoutStore()
const projectsStore = useProjectsStore()
</script>

<template>
  <SidebarProvider
    class="h-screen overflow-hidden"
    :style="{ '--sidebar-width': '14rem', '--sidebar-width-icon': '4.5rem' }"
  >
    <Sidebar />
    <SidebarInset class="flex flex-col overflow-hidden">
      <AppHeader />
      <div class="flex flex-1 min-h-0 overflow-hidden">
        <div class="flex-1 min-w-0 overflow-hidden">
          <RouterView />
        </div>
        <RightPanel
          v-if="layoutStore.rightPanelOpen"
          :project-path="projectsStore.focusedProject?.path ?? ''"
        />
      </div>
    </SidebarInset>
  </SidebarProvider>
</template>
