import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Skill } from '@shared/ipc-contract'

export const useSkillsDataStore = defineStore('skillsData', () => {
  const skills = ref<Skill[]>([])
  const loading = ref(false)

  let _key = ''
  let _promise: Promise<void> | null = null

  async function _doLoad(projectPath: string): Promise<void> {
    loading.value = true
    try {
      skills.value = await window.agentkeeper.skills.list(projectPath)
    } finally {
      loading.value = false
    }
  }

  function load(projectPath: string): Promise<void> {
    if (projectPath === _key && _promise) return _promise
    _key = projectPath
    _promise = _doLoad(projectPath)
    return _promise
  }

  function invalidate(): void {
    _key = ''
    _promise = null
  }

  return { skills, loading, load, invalidate }
})
