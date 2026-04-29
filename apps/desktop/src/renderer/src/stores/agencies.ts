import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Agency, AgencyDraft, AgencyScope, Role } from '../../../shared/ipc-contract'

export const useAgenciesStore = defineStore('agencies', () => {
  const agencies = ref<Agency[]>([])
  const roles = ref<Role[]>([])
  const loading = ref(false)
  let loadGeneration = 0

  async function loadAll(projectPath: string): Promise<void> {
    const gen = ++loadGeneration
    loading.value = true
    try {
      const [agenciesList, rolesList] = await Promise.all([
        window.agentkeeper.agencies.list(projectPath),
        window.agentkeeper.roles.list(projectPath),
      ])
      if (gen !== loadGeneration) return
      agencies.value = agenciesList
      roles.value = rolesList
    } finally {
      if (gen === loadGeneration) loading.value = false
    }
  }

  async function saveAgency(
    scope: AgencyScope,
    projectPath: string,
    draft: AgencyDraft,
  ): Promise<Agency> {
    const saved = await window.agentkeeper.agencies.save(scope, projectPath, draft)
    await loadAll(projectPath)
    return saved
  }

  async function removeAgency(
    scope: AgencyScope,
    projectPath: string,
    id: string,
  ): Promise<void> {
    await window.agentkeeper.agencies.remove(scope, projectPath, id)
    await loadAll(projectPath)
  }

  return { agencies, roles, loading, loadAll, saveAgency, removeAgency }
})
