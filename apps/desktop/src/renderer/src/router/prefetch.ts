import type { Router } from 'vue-router'
import { useProjectsStore } from '@/stores/projects'
import { usePlansStore } from '@/stores/plans'
import { useCommandsDataStore } from '@/stores/commandsData'
import { useSkillsDataStore } from '@/stores/skillsData'
import { useSessionsListStore } from '@/stores/sessionsList'

export function installPrefetchGuard(router: Router): void {
  router.beforeEach((to) => {
    const projectsStore = useProjectsStore()
    const projects = projectsStore.projects
    const focusedPath = projectsStore.focusedProject?.path ?? ''

    switch (to.path) {
      case '/sessions':
        if (projects.length) void useSessionsListStore().load(projects)
        break
      case '/planner':
        if (focusedPath) void usePlansStore().load(focusedPath)
        break
      case '/commands':
        void useCommandsDataStore().load(focusedPath)
        break
      case '/skills':
        void useSkillsDataStore().load(focusedPath)
        break
    }
  })
}
