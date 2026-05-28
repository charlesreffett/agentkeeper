<script setup lang="ts">
import { RouterView } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import RightPanel from '@/components/RightPanel.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useLayoutStore } from '@/stores/layout'
import { useProjectsQuery } from '@/composables/useProjectsQuery'

const layoutStore = useLayoutStore()
const { focusedProject } = useProjectsQuery()
</script>

<template>
  <div class="h-screen flex flex-col overflow-hidden">
    <AppHeader />
    <SidebarProvider
      class="flex-1 overflow-hidden"
      :style="{ '--sidebar-width': '14rem', '--sidebar-width-icon': '4.5rem' }"
    >
      <Sidebar />
      <SidebarInset class="flex flex-col overflow-hidden">
        <div class="flex flex-1 min-h-0 overflow-hidden">
          <div class="flex-1 min-w-0 overflow-hidden">
            <RouterView />
          </div>
          <RightPanel
            v-if="layoutStore.rightPanelOpen"
            :project-path="focusedProject?.path ?? ''"
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  </div>
</template>
