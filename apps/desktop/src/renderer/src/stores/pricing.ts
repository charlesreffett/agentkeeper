import { defineStore } from 'pinia'
import { ref } from 'vue'
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

export const usePricingStore = defineStore('pricing', () => {
  const table = ref<Record<string, ModelPricing>>({})
  const loaded = ref(false)

  async function load(): Promise<void> {
    if (loaded.value) return
    try {
      table.value = await window.agentkeeper.pricing.getTable()
      loaded.value = true
    } catch { /* non-fatal — breakdowns will show $0 */ }
  }

  async function refresh(): Promise<void> {
    try {
      table.value = await window.agentkeeper.pricing.refresh()
    } catch { /* non-fatal */ }
  }

  function lookup(modelId: string): ModelPricing | null {
    const n = normalizeId(modelId)
    if (table.value[n]) return table.value[n]!
    for (const [key, p] of Object.entries(table.value)) {
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

  return { table, loaded, load, refresh, lookup, estimateBreakdown }
})
