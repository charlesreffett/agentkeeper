import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentProject } from '@shared/ipc-contract'

export const useProjectStore = defineStore('project', () => {
  const currentProject = ref<RecentProject | null>(null)

  function setProject(p: RecentProject) {
    currentProject.value = p
  }

  function clearProject() {
    currentProject.value = null
  }

  return { currentProject, setProject, clearProject }
})
