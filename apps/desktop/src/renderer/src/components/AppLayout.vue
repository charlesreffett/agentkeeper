<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import Sidebar from '@/components/Sidebar.vue'
import SettingsSidebar from '@/components/SettingsSidebar.vue'
import AppHeader from '@/components/AppHeader.vue'
import RightPanel from '@/components/RightPanel.vue'
import TerminalPanel from '@/components/TerminalPanel.vue'
import { computed } from 'vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useLayoutStore } from '@/stores/layout'
import { useSessionStore } from '@/stores/sessions'
import { useTerminalStore } from '@/stores/terminalStore'
import { isGeneralProject } from '@shared/ipc-contract'
import { isSettingsRoute } from '@/lib/settingsShell'

const layoutStore = useLayoutStore()
const sessionStore = useSessionStore()
const terminalStore = useTerminalStore()
const route = useRoute()
const isSettings = computed(() => isSettingsRoute(route.path))

// The right panel + terminal follow the active session's context, not an
// app-wide focus. General (no-project) sessions have no repository to inspect.
const activeProjectPath = computed(() => {
  const p = sessionStore.currentSession?.projectPath
  return p && !isGeneralProject(p) ? p : ''
})
const activeProjectName = computed(() => activeProjectPath.value.split('/').pop() ?? 'Terminal')

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 't' || e.key === 'T')) {
    if (!terminalStore.isOpen || !terminalStore.focused) return
    e.preventDefault()
    terminalStore.addTab(activeProjectName.value)
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <SidebarProvider
    class="h-screen overflow-hidden flex-col"
    :style="{ '--sidebar-width': '14rem', '--sidebar-width-icon': '4rem' }"
  >
    <AppHeader />
    <div class="flex flex-1 min-h-0 overflow-hidden [transform:translateZ(0)]">
      <SettingsSidebar v-if="isSettings" />
      <Sidebar v-else />
      <SidebarInset class="flex flex-col overflow-hidden min-h-0">
        <div class="flex flex-col flex-1 min-h-0">
          <div class="flex flex-1 min-h-0 overflow-hidden">
            <div class="flex-1 min-w-0 overflow-hidden">
              <RouterView />
            </div>
            <RightPanel
              v-if="layoutStore.rightPanelOpen && !isSettings"
              :project-path="activeProjectPath"
            />
          </div>
          <TerminalPanel v-if="terminalStore.isOpen && !isSettings" />
        </div>
      </SidebarInset>
    </div>
  </SidebarProvider>
</template>
