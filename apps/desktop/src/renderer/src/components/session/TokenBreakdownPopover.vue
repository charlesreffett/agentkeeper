<script setup lang="ts">
import { computed } from 'vue'
import { Info } from 'lucide-vue-next'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useSessionStore } from '@/stores/sessions'
import { usePricingQuery } from '@/composables/usePricingQuery'
import { useModelsQuery } from '@/composables/useModelsQuery'

const props = defineProps<{
  sessionId: string
  side?: 'top' | 'right' | 'bottom' | 'left'
}>()

const store = useSessionStore()
const { estimateBreakdown } = usePricingQuery()
const { resolvedLabelFor } = useModelsQuery()

const tokenData = computed(() => store.sessionTokens[props.sessionId])
const session = computed(() => store.getSession(props.sessionId))

const hasBreakdown = computed(() => {
  const td = tokenData.value
  return !!td && (td.inputTokens > 0 || td.outputTokens > 0 || td.cacheReadTokens > 0 || td.cacheCreationTokens > 0)
})

// True when per-type costs were recorded at turn time (post-migration rows).
// False for legacy entries — fall back to current-pricing estimates in that case.
const hasStoredCosts = computed(() => {
  const td = tokenData.value
  if (!td) return false
  return (td.inputCostUsd + td.outputCostUsd + td.cacheReadCostUsd + td.cacheCreationCostUsd) > 0
})

const breakdown = computed(() => {
  const td = tokenData.value
  if (!hasBreakdown.value || !td) return null
  if (hasStoredCosts.value) {
    return {
      inputCost: td.inputCostUsd,
      outputCost: td.outputCostUsd,
      cacheReadCost: td.cacheReadCostUsd,
      cacheCreationCost: td.cacheCreationCostUsd,
      total: td.inputCostUsd + td.outputCostUsd + td.cacheReadCostUsd + td.cacheCreationCostUsd,
    }
  }
  const model = session.value?.model
  if (!model) return null
  return estimateBreakdown(td.inputTokens, td.outputTokens, td.cacheReadTokens, td.cacheCreationTokens, model)
})

const totalCost = computed(() => tokenData.value?.costUsd ?? 0)

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
</script>

<template>
  <Popover>
    <PopoverTrigger as-child>
      <button
        class="inline-flex items-center text-muted-foreground/40 hover:text-muted-foreground transition-colors rounded focus-visible:outline-none"
        title="Token cost breakdown"
      >
        <Info class="size-2.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent :side="side ?? 'bottom'" class="w-[230px] p-0 text-[11px]">
      <!-- Header -->
      <div class="px-3 pt-2.5 pb-2 border-b border-border/60">
        <div class="font-semibold text-foreground">Token Breakdown</div>
        <div class="text-[10px] text-muted-foreground/60 mt-0.5">
          {{ resolvedLabelFor(session?.model) }}{{ !hasStoredCosts ? ' · estimated' : '' }}
        </div>
      </div>

      <!-- Breakdown rows -->
      <div class="px-3 py-2.5 space-y-1.5">
        <template v-if="breakdown">
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground">Input</span>
            <div class="flex items-center gap-2 tabular-nums">
              <span class="text-muted-foreground/50">{{ fmtTokens(tokenData!.inputTokens) }}</span>
              <span class="text-foreground w-[52px] text-right">{{ formatCost(breakdown.inputCost) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground">Output</span>
            <div class="flex items-center gap-2 tabular-nums">
              <span class="text-muted-foreground/50">{{ fmtTokens(tokenData!.outputTokens) }}</span>
              <span class="text-foreground w-[52px] text-right">{{ formatCost(breakdown.outputCost) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground">Cache read</span>
            <div class="flex items-center gap-2 tabular-nums">
              <span class="text-muted-foreground/50">{{ fmtTokens(tokenData!.cacheReadTokens) }}</span>
              <span class="text-foreground w-[52px] text-right">{{ formatCost(breakdown.cacheReadCost) }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground">Cache write</span>
            <div class="flex items-center gap-2 tabular-nums">
              <span class="text-muted-foreground/50">{{ fmtTokens(tokenData!.cacheCreationTokens) }}</span>
              <span class="text-foreground w-[52px] text-right">{{ formatCost(breakdown.cacheCreationCost) }}</span>
            </div>
          </div>
          <div class="border-t border-border/60 pt-1.5 flex items-center justify-between font-medium">
            <span class="text-foreground">Total</span>
            <span class="text-foreground tabular-nums">{{ formatCost(totalCost || breakdown.total) }}</span>
          </div>
        </template>

        <template v-else>
          <div class="text-muted-foreground/50 italic py-0.5">
            Per-type data tracked from new turns
          </div>
          <div
            v-if="totalCost > 0"
            class="border-t border-border/60 pt-1.5 flex items-center justify-between font-medium"
          >
            <span class="text-foreground">Total</span>
            <span class="text-foreground tabular-nums">{{ formatCost(totalCost) }}</span>
          </div>
        </template>
      </div>
    </PopoverContent>
  </Popover>
</template>
