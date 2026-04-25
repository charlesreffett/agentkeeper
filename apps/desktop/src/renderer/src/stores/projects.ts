import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentProject } from '@shared/ipc-contract'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<RecentProject[]>([])
  const focusedProject = ref<RecentProject | null>(null)

  async function load() {
    const [list, focused] = await Promise.all([
      window.orchestral.projects.list(),
      window.orchestral.projects.getFocused(),
    ])
    projects.value = list
    focusedProject.value = focused
  }

  async function add(projectPath: string) {
    await window.orchestral.projects.add(projectPath)
    await load()
  }

  async function remove(projectPath: string) {
    await window.orchestral.projects.remove(projectPath)
    await load()
  }

  async function setFocused(projectPath: string | null) {
    await window.orchestral.projects.setFocused(projectPath)
    focusedProject.value = projectPath
      ? (projects.value.find((p) => p.path === projectPath) ?? null)
      : null
  }

  async function pickAndAdd() {
    const projectPath = await window.orchestral.projects.pickFolder()
    if (projectPath) await add(projectPath)
  }

  return { projects, focusedProject, load, add, remove, setFocused, pickAndAdd }
})
