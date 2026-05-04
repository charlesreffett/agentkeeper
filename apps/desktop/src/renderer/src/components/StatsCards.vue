<script setup lang="ts">
import { computed } from 'vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { projectColor } from '@/lib/projectColor'
import { useTimeSeries } from '@/composables/useTimeSeries'
import SparklineChart from '@/components/SparklineChart.vue'
import DonutChart from '@/components/DonutChart.vue'

const sessionStore = useSessionStore()
const projectsStore = useProjectsStore()

// Prefer authoritative counts from main; fall back to renderer-derived values
// before the first result message arrives (e.g. on fresh load).
const runningCount = computed(
  () => sessionStore.runningSessionCount || sessionStore.statusCounts.running,
)
const totalCount = computed(
  () => sessionStore.activeAgentCount || sessionStore.visibleSessions.length,
)
const activeSparkline = useTimeSeries(() => runningCount.value, { intervalMs: 30_000 })

const subAgentStats = computed(() => {
  const runningSessions = sessionStore.visibleSessions.filter(
    (s) => (s.status === 'running' || s.status === 'starting') && s.agencyInstanceId,
  )
  return {
    total: runningSessions.reduce((sum, s) => sum + sessionStore.subAgentCount(s), 0),
    sessionCount: runningSessions.length,
  }
})
const agentSparkline = useTimeSeries(() => subAgentStats.value.total, { intervalMs: 30_000 })

const tokenStats = computed(() => sessionStore.tokenStats)
const tokenSparkline = computed(() => tokenStats.value.dailyHistory.map((d) => d.tokens))

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`
}

const projectSegments = computed(() => {
  const pathCounts = new Map<string, number>()
  for (const s of sessionStore.visibleSessions) {
    pathCounts.set(s.projectPath, (pathCounts.get(s.projectPath) ?? 0) + 1)
  }
  return projectsStore.projects
    .filter((p) => pathCounts.has(p.path))
    .map((p) => ({
      label: p.name,
      value: pathCounts.get(p.path)!,
      color: projectColor(p.name),
    }))
})
</script>

<template>
  <div class="grid grid-cols-4 gap-4">
    <!-- Card 1: Active Sessions -->
    <div class="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Active Sessions
      </span>
      <div class="flex items-baseline gap-1.5">
        <span class="text-3xl font-bold leading-none">{{ runningCount }}</span>
        <span class="text-sm text-muted-foreground">of {{ totalCount }}</span>
      </div>
      <SparklineChart :data="activeSparkline" color="#6366f1" :height="36" class="mt-auto" />
    </div>

    <!-- Card 2: Sub-Agents Working -->
    <div class="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Sub-Agents Working
      </span>
      <div class="flex items-baseline gap-1.5">
        <span class="text-3xl font-bold leading-none">{{ subAgentStats.total }}</span>
        <span class="text-sm text-muted-foreground">
          across {{ subAgentStats.sessionCount }}
          {{ subAgentStats.sessionCount === 1 ? 'session' : 'sessions' }}
        </span>
      </div>
      <SparklineChart :data="agentSparkline" color="#a855f7" :height="36" class="mt-auto" />
    </div>

    <!-- Card 3: Tokens Today -->
    <div class="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Tokens · Today
      </span>
      <div class="flex items-baseline gap-1.5">
        <span class="text-3xl font-bold leading-none">{{ formatTokens(tokenStats.tokensToday) }}</span>
        <span class="text-sm text-muted-foreground">{{ formatCost(tokenStats.costUsdToday) }}</span>
      </div>
      <SparklineChart :data="tokenSparkline" color="#f59e0b" :height="36" class="mt-auto" />
    </div>

    <!-- Card 4: By Project -->
    <div class="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        By Project
      </span>
      <div class="flex items-center gap-4 flex-1">
        <DonutChart
          :segments="projectSegments"
          :total="totalCount"
          :size="72"
        />
        <div class="flex flex-col gap-1 min-w-0">
          <div
            v-for="seg in projectSegments"
            :key="seg.label"
            class="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: seg.color }" />
            <span class="truncate">{{ seg.label }}</span>
            <span class="ml-auto font-medium text-foreground tabular-nums">{{ seg.value }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
