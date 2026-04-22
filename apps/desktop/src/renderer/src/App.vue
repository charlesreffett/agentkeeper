<script setup lang="ts">
import { nextTick, ref } from 'vue'
import Welcome from './views/Welcome.vue'
import ProjectHome from './views/ProjectHome.vue'
import MonitorView from './views/MonitorView.vue'
import { useSessionStore } from './stores/sessions'
import type { RecentProject } from '@shared/ipc-contract'

type Mode = 'welcome' | 'project' | 'monitor'

const mode = ref<Mode>('welcome')
const currentProject = ref<RecentProject | null>(null)
const sessionStore = useSessionStore()

function openProject(project: RecentProject) {
  currentProject.value = project
  mode.value = 'project'
}

function closeProject() {
  currentProject.value = null
  mode.value = 'welcome'
}

function openMonitor() {
  mode.value = 'monitor'
}

function closeMonitor() {
  mode.value = 'welcome'
}

async function openFromMonitor(project: RecentProject, sessionId: string) {
  currentProject.value = project
  mode.value = 'project'
  // After ProjectHome mounts, focus the session in the store so its live view renders.
  await nextTick()
  sessionStore.focus(sessionId)
}
</script>

<template>
  <div class="h-screen w-screen bg-background text-foreground overflow-hidden">
    <ProjectHome
      v-if="mode === 'project' && currentProject"
      :project="currentProject"
      @close="closeProject"
    />
    <MonitorView
      v-else-if="mode === 'monitor'"
      @close="closeMonitor"
      @open="openFromMonitor"
    />
    <Welcome
      v-else
      @open="openProject"
      @monitor="openMonitor"
    />
  </div>
</template>
