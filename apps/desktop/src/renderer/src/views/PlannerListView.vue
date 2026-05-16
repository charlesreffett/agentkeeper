<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Filter, Sparkles, Play, Check, Loader2, MoreHorizontal, Eye, MonitorPlay, Pause, RefreshCw, Archive, X } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import NewPlanModal from '@/components/planner/NewPlanModal.vue'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePlansStore } from '@/stores/plans'
import type { Plan, PlanStatus } from '@shared/ipc-contract'

const router = useRouter()
const { focusedProject } = useProjectsQuery()
const plansStore = usePlansStore()
const plans = computed(() => plansStore.plans)
const loading = computed(() => plansStore.loading)

watch(
  () => focusedProject.value?.path,
  (path) => {
    if (path) void plansStore.load(path)
    else plansStore.invalidate()
  },
  { immediate: true },
)

// ── Live-refresh ─────────────────────────────────────────────────────────────

const generating = ref(false)
let pollInterval: ReturnType<typeof setInterval> | null = null
let unsubEvent: (() => void) | null = null

function tryDetectPlanWrite(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return
  const msg = raw as Record<string, unknown>
  if (msg['type'] !== 'assistant') return
  const inner = msg['message'] as Record<string, unknown> | undefined
  if (!inner) return
  const content = inner['content']
  if (!Array.isArray(content)) return
  for (const block of content) {
    const b = block as Record<string, unknown>
    if (b['type'] !== 'tool_use' || b['name'] !== 'Write') continue
    const input = b['input'] as Record<string, unknown> | undefined
    if (!input) continue
    const writePath = input['path'] as string | undefined
    if (!writePath?.includes('.agentkeeper/plans/')) continue
    generating.value = true
    if (focusedProject.value) void plansStore.refresh(focusedProject.value.path)
    break
  }
}

onMounted(() => {
  unsubEvent = window.agentkeeper.sessions.onEvent((event) => {
    tryDetectPlanWrite(event.message)
  })
  pollInterval = setInterval(() => {
    if (focusedProject.value) void plansStore.refresh(focusedProject.value.path)
  }, 5000)
})

onUnmounted(() => {
  if (pollInterval !== null) { clearInterval(pollInterval); pollInterval = null }
  unsubEvent?.()
  unsubEvent = null
})

watch(plans, (next, prev) => {
  if (next.length > (prev?.length ?? 0)) generating.value = false
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
  void router.push(`/planner/${plan.filename}`)
}

// ── Row context menu ─────────────────────────────────────────────────────────

const showNewPlan = ref(false)

const openMenuFilename = ref<string | null>(null)

function toggleMenu(plan: Plan, event: MouseEvent) {
  event.stopPropagation()
  openMenuFilename.value = openMenuFilename.value === plan.filename ? null : plan.filename
}

function closeMenu() {
  openMenuFilename.value = null
}
</script>

<template>
  <div class="h-full flex flex-col bg-background" @click="closeMenu">
    <PageHeader title="Plans" description="Drafted by Claude">
      <template #actions>
        <button class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors">
          <Filter :size="14" />
          Filter
        </button>
        <button
          class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
          @click="showNewPlan = true"
        >
          <Sparkles :size="14" />
          Plan with Claude
        </button>
      </template>
    </PageHeader>

    <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
      <!-- No project -->
      <div v-if="!focusedProject" class="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Focus a project to see its plans.
      </div>

      <!-- Loading -->
      <div v-else-if="loading" class="flex items-center justify-center h-48 text-sm text-muted-foreground">
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

        <!-- In-progress banner -->
        <div
          v-if="generating"
          class="mb-3 flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-500/10 border border-amber-200/60 dark:border-amber-500/20 rounded-lg px-4 py-2.5"
        >
          <Loader2 class="size-3.5 animate-spin shrink-0" />
          A session is writing a plan — refreshing automatically…
        </div>

        <!-- Empty state -->
        <div
          v-if="plans.length === 0"
          class="flex items-center justify-center h-32 text-sm text-muted-foreground border border-border rounded-lg"
        >
          No plans yet — use "Plan with Claude" on a Jira ticket.
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
            :key="plan.filename"
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
                <div class="text-sm font-semibold truncate">{{ plan.title }}</div>
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
                v-if="plan.workItemId"
                :to="`/jira/issue/${plan.workItemId}`"
                class="text-xs px-2 py-0.5 rounded-md border border-border font-mono bg-background hover:bg-muted/60 transition-colors"
                @click.stop
              >
                {{ plan.externalRef || plan.workItemId }}
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
            <div class="relative" @click.stop>
              <button
                class="size-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                :class="{ 'bg-muted/60 text-foreground': openMenuFilename === plan.filename }"
                @click="toggleMenu(plan, $event)"
              >
                <MoreHorizontal :size="14" />
              </button>

              <div
                v-if="openMenuFilename === plan.filename"
                class="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border bg-popover shadow-lg z-50 py-1 text-sm"
              >
                <button
                  class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left"
                  @click="goToDetail(plan); closeMenu()"
                >
                  <Eye :size="13" class="text-muted-foreground shrink-0" />
                  Open plan
                </button>
                <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                  <MonitorPlay :size="13" class="text-muted-foreground shrink-0" />
                  Open session
                </button>
                <button
                  v-if="plan.status === 'running'"
                  class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left"
                >
                  <Pause :size="13" class="text-muted-foreground shrink-0" />
                  Pause
                </button>
                <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                  <RefreshCw :size="13" class="text-muted-foreground shrink-0" />
                  Re-plan
                </button>
                <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                  <Archive :size="13" class="text-muted-foreground shrink-0" />
                  Archive
                </button>
                <div class="my-1 border-t border-border" />
                <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left text-destructive">
                  <X :size="13" class="shrink-0" />
                  Remove plan
                </button>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>

  <NewPlanModal :open="showNewPlan" @close="showNewPlan = false" />
</template>
