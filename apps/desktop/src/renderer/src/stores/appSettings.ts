import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AppSettings, GitHubConfig } from '@shared/ipc-contract'

export const useAppSettingsStore = defineStore('appSettings', () => {
  const settings = ref<AppSettings | null>(null)
  const apiKeyStored = ref(false)
  const githubConfig = ref<GitHubConfig>({ repos: [] })
  const loading = ref(false)

  let _loaded = false
  let _promise: Promise<void> | null = null

  async function _doLoad(): Promise<void> {
    loading.value = true
    try {
      const [s, hasKey, ghCfg] = await Promise.all([
        window.agentkeeper.settings.get(),
        window.agentkeeper.secrets.has('anthropicApiKey'),
        window.agentkeeper.github.getConfig(),
      ])
      settings.value = s
      apiKeyStored.value = hasKey
      githubConfig.value = ghCfg
    } finally {
      loading.value = false
    }
  }

  function load(): Promise<void> {
    if (_loaded && _promise) return _promise
    _loaded = true
    _promise = _doLoad()
    return _promise
  }

  function invalidate(): void {
    _loaded = false
    _promise = null
  }

  return { settings, apiKeyStored, githubConfig, loading, load, invalidate }
})
