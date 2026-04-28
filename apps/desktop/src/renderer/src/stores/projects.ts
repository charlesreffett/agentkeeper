import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { RecentProject } from '@shared/ipc-contract'

export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<RecentProject[]>([])
  const focusedProject = ref<RecentProject | null>(null)

  async function load() {
    const [list, focused] = await Promise.all([
      window.agentkeeper.projects.list(),
      window.agentkeeper.projects.getFocused(),
    ])
    projects.value = list
    focusedProject.value = focused
  }

  async function add(projectPath: string) {
    await window.agentkeeper.projects.add(projectPath)
    await load()
  }

  async function remove(projectPath: string) {
    await window.agentkeeper.projects.remove(projectPath)
    await load()
  }

  async function setFocused(projectPath: string | null) {
    await window.agentkeeper.projects.setFocused(projectPath)
    focusedProject.value = projectPath
      ? (projects.value.find((p) => p.path === projectPath) ?? null)
      : null
  }

  async function rename(oldPath: string, newName: string, renameDir: boolean) {
    const updated = await window.agentkeeper.projects.rename(oldPath, newName, renameDir)
    await load()
    if (focusedProject.value?.path === oldPath) {
      focusedProject.value = updated
    }
  }

  async function pickAndAdd() {
    const projectPath = await window.agentkeeper.projects.pickFolder()
    if (projectPath) await add(projectPath)
  }

  return { projects, focusedProject, load, add, remove, rename, setFocused, pickAndAdd }
})
