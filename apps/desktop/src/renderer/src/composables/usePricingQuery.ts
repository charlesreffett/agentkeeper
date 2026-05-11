import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { ModelPricing } from '@shared/ipc-contract'

export type { ModelPricing }

export interface CostBreakdown {
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheCreationCost: number
  total: number
}

function normalizeId(id: string): string {
  return id.toLowerCase().replace(/-\d{8}$/, '')
}

export function usePricingQuery() {
  const queryClient = useQueryClient()

  const { data: table, isLoading } = useQuery({
    queryKey: queryKeys.pricing.table(),
    queryFn: () => window.agentkeeper.pricing.getTable(),
    staleTime: Infinity,
  })

  const { mutate: refresh, isPending: isRefreshing } = useMutation({
    mutationFn: () => window.agentkeeper.pricing.refresh(),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.pricing.table(), data)
    },
  })

  function lookup(modelId: string): ModelPricing | null {
    const t = table.value
    if (!t) return null
    const n = normalizeId(modelId)
    if (t[n]) return t[n]!
    for (const [key, p] of Object.entries(t)) {
      if (n.startsWith(key) || key.startsWith(n)) return p
    }
    return null
  }

  function estimateBreakdown(
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    modelId: string,
  ): CostBreakdown {
    const p = lookup(modelId)
    if (!p) return { inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheCreationCost: 0, total: 0 }
    const M = 1_000_000
    const inputCost = (inputTokens / M) * p.input
    const outputCost = (outputTokens / M) * p.output
    const cacheReadCost = (cacheReadTokens / M) * p.cacheRead
    const cacheCreationCost = (cacheCreationTokens / M) * p.cacheWrite5m
    return { inputCost, outputCost, cacheReadCost, cacheCreationCost, total: inputCost + outputCost + cacheReadCost + cacheCreationCost }
  }

  return { table, isLoading, refresh, isRefreshing, lookup, estimateBreakdown }
}
