import { computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { RoleDraft, RoleScope } from '@shared/ipc-contract'

export function useRolesQuery(projectPath: { value: string | null }) {
  const queryClient = useQueryClient()

  const { data: roles, isLoading } = useQuery({
    queryKey: computed(() => queryKeys.roles.list(projectPath.value)),
    queryFn: () => window.agentkeeper.roles.list(projectPath.value),
    // '' = All scope — the union query serves that page state.
    enabled: computed(() => projectPath.value !== ''),
  })

  const { mutateAsync: saveRole } = useMutation({
    mutationFn: ({ scope, path, draft }: { scope: RoleScope; path: string | null; draft: RoleDraft }) =>
      window.agentkeeper.roles.save(scope, path, draft),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.list(projectPath.value) }),
  })

  const { mutateAsync: removeRole } = useMutation({
    mutationFn: ({ scope, path, id }: { scope: RoleScope; path: string | null; id: string }) =>
      window.agentkeeper.roles.remove(scope, path, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.list(projectPath.value) }),
  })

  return {
    roles: computed(() => roles.value ?? []),
    isLoading,
    saveRole,
    removeRole,
  }
}
