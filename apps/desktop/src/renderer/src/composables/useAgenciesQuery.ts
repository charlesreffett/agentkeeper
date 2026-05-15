import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { AgencyDraft, AgencyScope } from '@shared/ipc-contract'

export function useAgenciesQuery(projectPath: { value: string }) {
  const queryClient = useQueryClient()

  const { data: agencies, isLoading } = useQuery({
    queryKey: computed(() => queryKeys.agencies.list(projectPath.value)),
    queryFn: () => window.agentkeeper.agencies.list(projectPath.value),
    enabled: computed(() => !!projectPath.value),
  })

  const { mutateAsync: saveAgency } = useMutation({
    mutationFn: ({ scope, path, draft }: { scope: AgencyScope; path: string; draft: AgencyDraft }) =>
      window.agentkeeper.agencies.save(scope, path, draft),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agencies.list(projectPath.value) }),
  })

  const { mutateAsync: removeAgency } = useMutation({
    mutationFn: ({ scope, path, id }: { scope: AgencyScope; path: string; id: string }) =>
      window.agentkeeper.agencies.remove(scope, path, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agencies.list(projectPath.value) }),
  })

  return {
    agencies: computed(() => agencies.value ?? []),
    isLoading,
    saveAgency,
    removeAgency,
  }
}
