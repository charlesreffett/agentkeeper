import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'

export function useSettingsQuery() {
  const queryClient = useQueryClient()

  const { data: appSettings, isLoading } = useQuery({
    queryKey: queryKeys.settings.app(),
    queryFn: () => window.agentkeeper.settings.get(),
    staleTime: 0,
  })

  function invalidateAll() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
  }

  const { mutateAsync: saveSettings } = useMutation({
    mutationFn: (s: Parameters<typeof window.agentkeeper.settings.set>[0]) =>
      window.agentkeeper.settings.set(s),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.settings.app() }),
  })

  return {
    settings: appSettings,
    isLoading,
    invalidateAll,
    saveSettings,
  }
}
