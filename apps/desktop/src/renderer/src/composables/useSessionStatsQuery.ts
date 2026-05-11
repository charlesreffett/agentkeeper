import { useQuery } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'

export function useSessionStatsQuery() {
  return useQuery({
    queryKey: queryKeys.stats.all(),
    queryFn: () => window.agentkeeper.stats.getAll(),
    staleTime: 60_000,
  })
}
