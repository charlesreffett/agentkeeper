<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useRouter } from 'vue-router'
import { Filter, Sparkles, Play, Check, Loader2, MoreHorizontal, Eye, MonitorPlay, Pause, RefreshCw, Archive, X } from '@/components/icons/app-icons'
import NewPlanModal from '@/components/planner/NewPlanModal.vue'
import ScopeBar from '@/components/ScopeBar.vue'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePageScope, SCOPE_ALL } from '@/composables/usePageScope'
import { projectColor } from '@/lib/projectColor'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePlansStore } from '@/stores/plans'
import type { Plan, PlanStatus } from '@shared/ipc-contract'

type PlanWithProject = Plan & { projectPath?: string }

const router = useRouter()
const { scope, options, label, color, setScope, pickAndAdd, isAll, isProject, currentProject } =
  usePageScope('planner')
const { projects } = useProjectsQuery()
const queryClient = useQueryClient()
const plansStore = usePlansStore()
const loading = computed(() => (isAll.value ? allLoading.value : plansStore.loading))

// All scope = union across every registered project, tagged with each plan's
// owning project so archive/delete/refresh target the right one.
const { data: allPlans, isLoading: allLoading } = useQuery({
  queryKey: computed(() => ['plans', 'list', SCOPE_ALL, projects.value.map((p) => p.path).sort().join('|')]),
  enabled: isAll,
  queryFn: async () => {
    const paths = projects.value.map((p) => p.path)
    const lists = await Promise.all(paths.map((p) => window.agentkeeper.plans.list(p)))
    const seen = new Set<string>()
    const out: PlanWithProject[] = []
    for (let i = 0; i < lists.length; i++) {
      const projectPath = paths[i]!
      for (const plan of lists[i]!) {
        if (seen.has(plan.id)) continue
        seen.add(plan.id)
        out.push({ ...plan, projectPath })
      }
    }
    return out
  },
})

const plans = computed<PlanWithProject[]>(() =>
  isAll.value
    ? (allPlans.value ?? []).filter((p) => p.status !== 'archived')
    : plansStore.plans.filter((p) => p.status !== 'archived'),
)

// The concrete project backing a plan row: its own path in All, the scoped
// project otherwise. null when the page is scoped to nothing (planner is
// project-bound — All is a read-only union).
function planProjectPath(plan: PlanWithProject): string | null {
  if (isAll.value) return plan.projectPath ?? null
  return isProject.value ? currentProject.value?.path ?? null : null
}

function workItemPath(plan: PlanWithProject): string {
  const reference = plan.workItem!
  return `/plugin/${encodeURIComponent(reference.sourceId)}/work-items/${encodeURIComponent(reference.itemId)}`
}

function refreshPlans(planPath?: string): void {
  if (isAll.value) {
    void queryClient.invalidateQueries({ queryKey: ['plans', 'list', SCOPE_ALL] })
  } else if (planPath) {
    void plansStore.refresh(planPath)
  }
}

watch(
  () => scope.value,
  (path) => {
    if (isAll.value) {
      void queryClient.invalidateQueries({ queryKey: ['plans', 'list', SCOPE_ALL] })
    } else if (isProject.value && path) {
      void plansStore.refresh(path)
    } else {
      plansStore.invalidate()
    }
  },
  { immediate: true },
)

// ── Live-refresh ─────────────────────────────────────────────────────────────

let unsubPlanUpdated: (() => void) | null = null

onMounted(() => {
  unsubPlanUpdated = window.agentkeeper.plans.onUpdated(({ projectPath: p }) => {
    if (isAll.value) {
      void queryClient.invalidateQueries({ queryKey: ['plans', 'list', SCOPE_ALL] })
    } else if (isProject.value && currentProject.value?.path === p) {
      void plansStore.refresh(p)
    }
  })
})

onUnmounted(() => {
  unsubPlanUpdated?.()
  unsubPlanUpdated = null
})

// ── Derived counts ──────────────────────────────────────────────────────────

const stats = computed(() => ({
  total: plans.value.length,
  running: plans.value.filter((p) => p.status === 'running').length,
  drafting: plans.value.filter((p) => p.status === 'drafting').length,
  ready: plans.value.filter((p) => p.status === 'planned').length,
  complete: plans.value.filter((p) => p.status === 'complete').length,
}))

// ── Formatters ───────────────────────────────────────────────────────────────

function formatMinutes(total: number): string {
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function planTotal(plan: Plan): number {
  return plan.estimatedMinutes || plan.steps.reduce((s, x) => s + x.estimatedMinutes, 0)
}

function stepsCompleted(plan: Plan): number {
  return plan.steps.filter((s) => s.status === 'complete').length
}

function progressPercent(plan: Plan): number {
  if (!plan.steps.length) return 0
  return Math.round((stepsCompleted(plan) / plan.steps.length) * 100)
}

function parallelCount(plan: Plan): number {
  return plan.steps.filter((s) => s.parallel).length
}


function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function planRef(plan: Plan, index: number): string {
  if (plan.planRef) return plan.planRef
  return `PL-${String(index + 1).padStart(2, '0')}`
}

// ── Status visuals ───────────────────────────────────────────────────────────

function rowClass(status: PlanStatus): string {
  if (status === 'drafting') return 'bg-amber-50/40 dark:bg-amber-500/5'
  return ''
}

function progressBarClass(status: PlanStatus): string {
  if (status === 'complete') return 'bg-purple-500'
  if (status === 'running') return 'bg-green-500'
  return 'bg-muted-foreground/30'
}


function goToDetail(plan: Plan) {
  void router.push(`/planner/${plan.id}`)
}

// ── Row context menu ─────────────────────────────────────────────────────────

const showNewPlan = ref(false)

async function openSession(plan: Plan) {
  const sessionId = plan.sessionIds?.[plan.sessionIds.length - 1]
  if (!sessionId) return
  void router.push(`/sessions/${sessionId}`)
}

async function pausePlan(plan: PlanWithProject) {
  const sessionId = plan.sessionIds?.[plan.sessionIds.length - 1]
  if (!sessionId) return
  await window.agentkeeper.sessions.interrupt(sessionId)
  refreshPlans(planProjectPath(plan) ?? undefined)
}

async function archivePlan(plan: PlanWithProject) {
  const p = planProjectPath(plan)
  if (!p) return
  await window.agentkeeper.plans.update(p, plan.id, { status: 'archived' })
  refreshPlans(p)
}

async function removePlan(plan: PlanWithProject) {
  const p = planProjectPath(plan)
  if (!p) return
  await window.agentkeeper.plans.delete(p, plan.id)
  refreshPlans(p)
}

function projectNameForPlan(plan: PlanWithProject): string {
  if (!plan.projectPath) return ''
  const found = projects.value.find((pr) => pr.path === plan.projectPath)
  if (found) return found.name
  return plan.projectPath.split('/').pop() ?? plan.projectPath
}
</script>

<template>
  <div class="h-full flex bg-background">
    <aside class="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div class="p-3 border-b border-border shrink-0">
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
      </div>
      <div class="p-2 border-b border-border shrink-0 space-y-2">
        <button
          class="w-full flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
          :disabled="!isProject"
          :title="isProject ? '' : 'Scope to a project to create plans'"
          @click="showNewPlan = true"
        >
          <Sparkles :size="14" />
          Plan with Claude
        </button>
        <button
          class="w-full flex items-center justify-center gap-1.5 text-sm px-3 py-2 rounded-md border border-border hover:bg-muted/60 transition-colors"
        >
          <Filter :size="14" />
          Filter
        </button>
      </div>
    </aside>

    <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
      <!-- Loading -->
      <div v-if="loading" class="flex items-center justify-center h-48 text-sm text-muted-foreground">
        <Loader2 class="size-4 animate-spin mr-2" />
        Loading…
      </div>

      <template v-else>
        <!-- Stat cards -->
        <div class="grid grid-cols-5 gap-3 mb-5">
          <div class="rounded-lg border border-border px-4 py-3">
            <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Total</p>
            <div class="flex items-baseline gap-1.5">
              <span class="text-3xl font-bold">{{ stats.total }}</span>
              <span class="text-sm text-muted-foreground">plans</span>
            </div>
          </div>
          <div class="rounded-lg border border-border px-4 py-3">
            <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Running</p>
            <div class="flex items-baseline gap-1.5">
              <span class="text-3xl font-bold text-green-500">{{ stats.running }}</span>
              <span class="text-sm text-muted-foreground">in flight</span>
            </div>
          </div>
          <div class="rounded-lg border border-border px-4 py-3">
            <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Drafting</p>
            <div class="flex items-baseline gap-1.5">
              <span class="text-3xl font-bold text-amber-500">{{ stats.drafting }}</span>
              <span class="text-sm text-muted-foreground">being written</span>
            </div>
          </div>
          <div class="rounded-lg border border-border px-4 py-3">
            <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Ready</p>
            <div class="flex items-baseline gap-1.5">
              <span class="text-3xl font-bold">{{ stats.ready }}</span>
              <span class="text-sm text-muted-foreground">awaiting start</span>
            </div>
          </div>
          <div class="rounded-lg border border-border px-4 py-3">
            <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Complete</p>
            <div class="flex items-baseline gap-1.5">
              <span class="text-3xl font-bold text-muted-foreground">{{ stats.complete }}</span>
              <span class="text-sm text-muted-foreground">finished</span>
            </div>
          </div>
        </div>

        <!-- Empty state -->
        <div
          v-if="plans.length === 0"
          class="flex items-center justify-center h-32 text-sm text-muted-foreground border border-border rounded-lg"
        >
          No plans yet — create one from a work item or start in the Planner.
        </div>

        <!-- Table -->
        <div v-else class="rounded-lg border border-border overflow-hidden">
          <!-- Column headers -->
          <div class="grid grid-cols-[2fr_120px_180px_120px_32px] gap-4 px-4 py-2 bg-muted/30 border-b border-border text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
            <span>Plan</span>
            <span>Tickets</span>
            <span>Progress</span>
            <span class="text-right">Est. Time</span>
            <span />
          </div>

          <!-- Rows -->
          <div
            v-for="(plan, index) in plans"
            :key="plan.id"
            class="grid grid-cols-[2fr_120px_180px_120px_32px] gap-4 items-center px-4 py-3 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/40 transition-colors"
            :class="rowClass(plan.status)"
            @click="goToDetail(plan)"
          >
            <!-- Plan: icon + title + meta -->
            <div class="flex items-center gap-3 min-w-0">
              <!-- Status icon -->
              <div class="shrink-0 size-8 rounded-full flex items-center justify-center"
                :class="{
                  'bg-green-500 text-white': plan.status === 'running',
                  'bg-muted text-muted-foreground': plan.status === 'planned',
                  'bg-purple-500 text-white': plan.status === 'complete',
                  'border-2 border-dashed border-amber-400 text-amber-400': plan.status === 'drafting',
                }"
              >
                <Loader2 v-if="plan.status === 'drafting'" :size="14" class="animate-spin" />
                <Check v-else-if="plan.status === 'complete'" :size="14" />
                <Play v-else :size="12" class="ml-0.5" />
              </div>

              <div class="min-w-0">
                <div class="text-sm font-semibold truncate">
                  <span
                    v-if="isAll && plan.projectPath"
                    class="inline-flex items-center gap-1 mr-1.5 align-middle"
                  >
                    <span
                      class="size-2 rounded-full shrink-0"
                      :style="{ backgroundColor: projectColor(projectNameForPlan(plan)) }"
                    />
                    <span class="text-xs font-normal text-muted-foreground">
                      {{ projectNameForPlan(plan) }}
                    </span>
                  </span>
                  {{ plan.title }}
                </div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  <template v-if="plan.status === 'drafting'">
                    {{ plan.steps.length > 0 ? `${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''} so far` : 'Being written…' }}
                    · updated {{ relativeDate(plan.updatedAt) }}
                  </template>
                  <template v-else>
                    {{ stepsCompleted(plan) }}/{{ plan.steps.length }} steps
                    · {{ parallelCount(plan) }} parallel
                    · updated {{ relativeDate(plan.updatedAt) }}
                  </template>
                </div>
              </div>
            </div>

            <!-- Ticket ref -->
            <div>
              <router-link
                v-if="plan.workItem"
                :to="workItemPath(plan)"
                class="text-xs px-2 py-0.5 rounded-md border border-border font-mono bg-background hover:bg-muted/60 transition-colors"
                @click.stop
              >
                {{ plan.workItem.externalRef }}
              </router-link>
              <span v-else class="text-xs px-2 py-0.5 rounded-md border border-border font-mono bg-background text-muted-foreground">—</span>
            </div>

            <!-- Progress -->
            <div v-if="plan.status === 'drafting'" class="text-xs text-muted-foreground italic">
              drafting…
            </div>
            <div v-else class="flex items-center gap-2">
              <div class="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="progressBarClass(plan.status)"
                  :style="{ width: `${progressPercent(plan)}%` }"
                />
              </div>
              <span class="text-xs text-muted-foreground w-7 text-right shrink-0">{{ progressPercent(plan) }}%</span>
            </div>

            <!-- Est. time -->
            <div class="text-right">
              <div>{{ planTotal(plan) ? formatMinutes(planTotal(plan)) : '—' }}</div>
              <div v-if="plan.status === 'running' && progressPercent(plan) > 0" class="text-xs text-muted-foreground">
                {{ formatMinutes(Math.round(planTotal(plan) * (1 - progressPercent(plan) / 100))) }} left
              </div>
              <div v-else-if="plan.status === 'complete'" class="text-xs text-muted-foreground">
                actual {{ formatMinutes(plan.steps.reduce((s, x) => s + (x.actualMinutes ?? x.estimatedMinutes), 0)) }}
              </div>
            </div>

            <!-- Context menu -->
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  class="size-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                  @click.stop
                >
                  <MoreHorizontal :size="14" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem @click="goToDetail(plan)">
                  <Eye :size="13" class="text-muted-foreground shrink-0" />
                  Open plan
                </DropdownMenuItem>
                <DropdownMenuItem
                  :disabled="!plan.sessionIds?.length"
                  @click="void openSession(plan)"
                >
                  <MonitorPlay :size="13" class="text-muted-foreground shrink-0" />
                  Open session
                </DropdownMenuItem>
                <DropdownMenuItem
                  v-if="plan.status === 'running'"
                  @click="void pausePlan(plan)"
                >
                  <Pause :size="13" class="text-muted-foreground shrink-0" />
                  Pause
                </DropdownMenuItem>
                <DropdownMenuItem @click="goToDetail(plan)">
                  <RefreshCw :size="13" class="text-muted-foreground shrink-0" />
                  Re-plan
                </DropdownMenuItem>
                <DropdownMenuItem @click="void archivePlan(plan)">
                  <Archive :size="13" class="text-muted-foreground shrink-0" />
                  Archive
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  class="text-destructive focus:text-destructive"
                  @click="void removePlan(plan)"
                >
                  <X :size="13" class="shrink-0" />
                  Remove plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </template>
    </div>
  </div>

  <NewPlanModal :open="showNewPlan" @close="showNewPlan = false" />
</template>
