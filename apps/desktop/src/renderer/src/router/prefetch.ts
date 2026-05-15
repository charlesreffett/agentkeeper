import type { Router } from 'vue-router'
import { queryClient } from '@/lib/queryClient'
import { queryKeys } from '@/lib/queryKeys'
import { usePlansStore } from '@/stores/plans'
import { useCommandsDataStore } from '@/stores/commandsData'
import { useSkillsDataStore } from '@/stores/skillsData'
import type { RecentProject } from '@shared/ipc-contract'

export function installPrefetchGuard(router: Router): void {
  router.beforeEach((to) => {
    const focusedProject = queryClient.getQueryData<RecentProject | null>(queryKeys.projects.focused())
    const focusedPath = focusedProject?.path ?? ''

    switch (to.path) {
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
