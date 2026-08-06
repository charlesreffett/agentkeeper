import type { Router } from 'vue-router'
import { usePlansStore } from '@/stores/plans'
import { useCommandsDataStore } from '@/stores/commandsData'
import { useSkillsDataStore } from '@/stores/skillsData'
import { SCOPE_ALL, SCOPE_GLOBAL, SCOPE_GENERAL } from '@/composables/usePageScope'

// A concrete project path when the page's persisted scope is a project; '' for
// All/Global/General (the data stores treat '' as the global/no-project load).
function scopedPath(pageId: string): string {
  let scope: string | null = null
  try {
    scope = localStorage.getItem(`scope.${pageId}`)
  } catch {
    scope = null
  }
  if (!scope || scope === SCOPE_ALL || scope === SCOPE_GLOBAL || scope === SCOPE_GENERAL) return ''
  return scope
}

export function installPrefetchGuard(router: Router): void {
  router.beforeEach((to) => {
    switch (to.path) {
      case '/planner': {
        const path = scopedPath('planner')
        if (path) void usePlansStore().load(path)
        break
      }
      case '/commands':
        void useCommandsDataStore().load(scopedPath('commands'))
        break
      case '/skills':
        void useSkillsDataStore().load(scopedPath('skills'))
        break
    }
  })
}
