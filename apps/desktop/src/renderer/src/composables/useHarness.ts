import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { HarnessAuthInfo, HarnessInfo } from '@shared/ipc-contract'

export function useHarnessList() {
  return useQuery({
    queryKey: queryKeys.harness.list(),
    queryFn: (): Promise<HarnessInfo[]> => window.agentkeeper.harness.list(),
  })
}

export function useActiveHarness() {
  return useQuery({
    queryKey: queryKeys.harness.active(),
    queryFn: (): Promise<HarnessInfo> => window.agentkeeper.harness.getActive(),
  })
}

export function useSetActiveHarness() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => window.agentkeeper.harness.setActive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.harness.list() })
      void qc.invalidateQueries({ queryKey: queryKeys.harness.active() })
    },
  })
}

export function useHarnessAuth() {
  return useQuery({
    queryKey: queryKeys.harness.auth(),
    queryFn: (): Promise<HarnessAuthInfo[]> => window.agentkeeper.harness.auth(),
  })
}
