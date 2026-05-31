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
    // Use the path from mutation variables, not the reactive projectPath at callback time.
    // If the user switches projects while a save is in-flight, projectPath.value would be
    // wrong and the old cache would never be invalidated.
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agencies.list(variables.path) }),
  })

  const { mutateAsync: removeAgency } = useMutation({
    mutationFn: ({ scope, path, id }: { scope: AgencyScope; path: string; id: string }) =>
      window.agentkeeper.agencies.remove(scope, path, id),
    onSuccess: (_data, variables) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.agencies.list(variables.path) }),
  })

  return {
    agencies: computed(() => agencies.value ?? []),
    isLoading,
    saveAgency,
    removeAgency,
  }
}
