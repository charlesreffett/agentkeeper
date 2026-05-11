import { useQuery } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'

export function useDailyCostsQuery() {
  return useQuery({
    queryKey: queryKeys.costs.daily(),
    queryFn: () => window.agentkeeper.costs.getDailySummary(),
    staleTime: 60_000,
  })
}
