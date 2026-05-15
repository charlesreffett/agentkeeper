import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { GitHubConfig } from '@shared/ipc-contract'

export function useSettingsQuery() {
  const queryClient = useQueryClient()

  const { data: appSettings, isLoading: isLoadingSettings } = useQuery({
    queryKey: queryKeys.settings.app(),
    queryFn: () => window.agentkeeper.settings.get(),
    staleTime: 0,
  })

  const { data: apiKeyStored, isLoading: isLoadingKey } = useQuery({
    queryKey: queryKeys.settings.secrets(),
    queryFn: () => window.agentkeeper.secrets.has('anthropicApiKey'),
    staleTime: 0,
  })

  const { data: githubConfig, isLoading: isLoadingGithub } = useQuery({
    queryKey: queryKeys.settings.github(),
    queryFn: () => window.agentkeeper.github.getConfig(),
    staleTime: 0,
  })

  const isLoading = computed(
    () => isLoadingSettings.value || isLoadingKey.value || isLoadingGithub.value,
  )

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
  }

  const { mutateAsync: saveSettings } = useMutation({
    mutationFn: (s: Parameters<typeof window.agentkeeper.settings.set>[0]) =>
      window.agentkeeper.settings.set(s),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.app() }),
  })

  const { mutateAsync: saveGithubConfig } = useMutation({
    mutationFn: (cfg: GitHubConfig) => window.agentkeeper.github.setConfig(cfg),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.github() }),
  })

  return {
    settings: appSettings,
    apiKeyStored,
    githubConfig,
    isLoading,
    invalidateAll,
    saveSettings,
    saveGithubConfig,
  }
}
