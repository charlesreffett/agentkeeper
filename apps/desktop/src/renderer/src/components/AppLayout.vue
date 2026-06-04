<script setup lang="ts">
import { RouterView } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import RightPanel from '@/components/RightPanel.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useLayoutStore } from '@/stores/layout'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useTerminalStore } from '@/stores/terminalStore'

const layoutStore = useLayoutStore()
const { focusedProject } = useProjectsQuery()
const terminalStore = useTerminalStore()
</script>

<template>
  <SidebarProvider
    class="h-screen overflow-hidden flex-col"
    :style="{ '--sidebar-width': '14rem', '--sidebar-width-icon': '4rem' }"
  >
    <AppHeader />
    <div class="flex flex-1 min-h-0 overflow-hidden [transform:translateZ(0)]">
      <Sidebar />
      <SidebarInset class="flex flex-col overflow-hidden min-h-0">
        <div class="flex flex-col flex-1 min-h-0">
          <div class="flex flex-1 min-h-0 overflow-hidden">
            <div class="flex-1 min-w-0 overflow-hidden">
              <RouterView />
            </div>
            <RightPanel
              v-if="layoutStore.rightPanelOpen"
              :project-path="focusedProject?.path ?? ''"
            />
          </div>
          <TerminalPanel v-if="terminalStore.isOpen" />
        </div>
      </SidebarInset>
    </div>
  </SidebarProvider>
</template>
