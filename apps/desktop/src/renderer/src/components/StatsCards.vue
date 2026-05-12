<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionsListQuery } from '@/composables/useSessionsListQuery'
import { projectColor } from '@/lib/projectColor'
import { useTimeSeries } from '@/composables/useTimeSeries'
import SparklineChart from '@/components/SparklineChart.vue'
import DonutChart from '@/components/DonutChart.vue'

const sessionStore = useSessionStore()
const { projects } = useProjectsQuery()
const { persistedSessions } = useSessionsListQuery(projects)

const runningCount = computed(() => sessionStore.statusCounts.running)
const totalCount = computed(() => sessionStore.visibleSessions.length)
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

const hoveredDayIndex = ref<number | null>(null)

function formatDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number]
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const displayDay = computed(() => {
  if (hoveredDayIndex.value === null) return null
  return tokenStats.value.dailyHistory[hoveredDayIndex.value] ?? null
})

const displayLabel = computed(() => {
  if (!displayDay.value) return 'Today'
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return displayDay.value.date === todayKey ? 'Today' : formatDateKey(displayDay.value.date)
})

const displayTokens = computed(() => displayDay.value?.tokens ?? tokenStats.value.tokensToday)
const displayCost = computed(() => displayDay.value?.costUsd ?? tokenStats.value.costUsdToday)

const displayBreakdown = computed(() => {
  const day = displayDay.value
  if (!day) return null
  return {
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheCreationTokens: day.cacheCreationTokens,
  }
})

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)} est.`
}

const projectSegments = computed(() => {
  const pathCounts = new Map<string, number>()
  const liveIds = new Set(sessionStore.visibleSessions.map((s) => s.localId))
  for (const s of sessionStore.visibleSessions) {
    pathCounts.set(s.projectPath, (pathCounts.get(s.projectPath) ?? 0) + 1)
  }
  for (const s of persistedSessions.value) {
    if (!liveIds.has(s.localId) && !s.agencyInstanceId) {
      pathCounts.set(s.projectPath, (pathCounts.get(s.projectPath) ?? 0) + 1)
    }
  }
  return projects.value
    .filter((p) => pathCounts.has(p.path))
    .map((p) => ({
      label: p.name,
      value: pathCounts.get(p.path)!,
      color: projectColor(p.name),
    }))
})

const projectTotal = computed(() =>
  projectSegments.value.reduce((sum, seg) => sum + seg.value, 0),
)
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

    <!-- Card 3: Tokens -->
    <div class="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Tokens · {{ displayLabel }}
      </span>
      <div class="flex items-baseline gap-1.5">
        <span class="text-3xl font-bold leading-none">{{ formatTokens(displayTokens) }}</span>
        <span class="text-sm text-muted-foreground">{{ formatCost(displayCost) }}</span>
      </div>
      <div class="relative mt-auto">
        <div
          v-if="displayBreakdown"
          class="absolute top-full mt-1.5 left-0 right-0 bg-popover text-popover-foreground border rounded-md shadow-md text-xs p-2 pointer-events-none"
        >
          <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <span class="text-muted-foreground">Input</span>
            <span class="text-right tabular-nums">{{ displayBreakdown.inputTokens.toLocaleString() }}</span>
            <span class="text-muted-foreground">Output</span>
            <span class="text-right tabular-nums">{{ displayBreakdown.outputTokens.toLocaleString() }}</span>
            <span class="text-muted-foreground">Cache read</span>
            <span class="text-right tabular-nums">{{ displayBreakdown.cacheReadTokens.toLocaleString() }}</span>
            <span class="text-muted-foreground">Cache write</span>
            <span class="text-right tabular-nums">{{ displayBreakdown.cacheCreationTokens.toLocaleString() }}</span>
          </div>
        </div>
        <SparklineChart
          :data="tokenSparkline"
          :hovered-index="hoveredDayIndex"
          color="#f59e0b"
          :height="36"
          @hover="hoveredDayIndex = $event"
        />
      </div>
    </div>

    <!-- Card 4: By Project -->
    <div class="rounded-xl border bg-card p-4 flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        By Project
      </span>
      <div class="flex items-center gap-4 flex-1">
        <DonutChart
          :segments="projectSegments"
          :total="projectTotal"
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
