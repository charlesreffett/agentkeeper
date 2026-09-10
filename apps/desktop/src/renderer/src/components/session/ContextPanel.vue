<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Circle as CircleIcon, CircleCheckBig, CornerDownRight, FileCode2, GitBranch, Layers, ListTodo, Loader2, Play, Tag, User2 } from '@/components/icons/app-icons'
import TokenBreakdownPopover from './TokenBreakdownPopover.vue'
import { useSessionStore } from '@/stores/sessions'
import { formatRelativeTime } from '@/lib/format'
import { useModelsQuery } from '@/composables/useModelsQuery'
import type { Agent, GitDiffStatFile, LiveSessionStatus, Plan } from '@shared/ipc-contract'
import type { WorkItem } from '@shared/ipc-contract'

const props = defineProps<{
  collapsed: boolean
  rootSessionId: string
  selectedId: string
}>()
defineEmits<{ collapse: []; expand: []; 'update:selectedId': [id: string] }>()

const store = useSessionStore()
const router = useRouter()
// Scope model-label resolution to the session's harness, or an opencode model
// resolves against Claude's list and mislabels as the Claude default.
const { resolvedLabelFor } = useModelsQuery(() => store.getSession(props.rootSessionId)?.harnessId)

const rootSession = computed(() => store.getSession(props.rootSessionId))

// ─── Agent list ───────────────────────────────────────────────────────────────

const agents = computed((): Agent[] => rootSession.value?.agents ?? [])

const selectedAgent = computed(() =>
  agents.value.find(a => a.localId === props.selectedId) ??
  agents.value.find(a => a.isEntryPoint) ?? null
)

function isEntryPoint(a: Agent): boolean {
  return a.isEntryPoint
}

function rowLabel(a: Agent): string {
  if (isEntryPoint(a)) {
    const title = rootSession.value?.title ?? rootSession.value?.agencyPrompt ?? rootSession.value?.initialPrompt
    return title ? `Main · ${title}` : 'Main'
  }
  return a.roleName ?? 'Agent'
}

function statusDotClass(status: LiveSessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'blocked':
      return 'bg-blue-500'
    case 'completed':
    case 'inactive':
      return 'bg-muted-foreground/40'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground/40'
  }
}

function statusLabel(status: LiveSessionStatus): string {
  switch (status) {
    case 'starting':   return 'Starting'
    case 'running':    return 'Running'
    case 'idle':       return 'Idle'
    case 'suspended':  return 'Suspended'
    case 'blocked':    return 'Waiting'
    case 'completed':  return 'Completed'
    case 'inactive':   return 'Inactive'
    case 'error':      return 'Error'
    default:           return ''
  }
}

function statusTextClass(status: LiveSessionStatus): string {
  switch (status) {
    case 'running':
    case 'starting':
      return 'text-emerald-500'
    case 'idle':
    case 'suspended':
      return 'text-amber-500'
    case 'blocked':
      return 'text-blue-500'
    case 'error':
      return 'text-destructive'
    default:
      return 'text-muted-foreground'
  }
}

function agentName(a: Agent): string {
  if (isEntryPoint(a)) return a.roleName ?? 'Main agent'
  return a.roleName ?? 'Agent'
}

// ─── Derived stats ────────────────────────────────────────────────────────────

const turnCount = computed(() => store.sessionTurns[props.rootSessionId] ?? 0)

// Session-level totals persist across restarts; add the selected agent's
// currently-streaming partial on top for a live running estimate.
const tokens = computed(() => {
  const base = store.sessionTokens[props.rootSessionId]?.tokens ?? 0
  const inFlight = (store.sessionRunTokens[props.selectedId] ?? 0) + (store.sessionOutputEstimates[props.selectedId] ?? 0)
  return base + inFlight
})
const costUsd = computed(() => store.sessionTokens[props.rootSessionId]?.costUsd ?? 0)

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

// ─── Provider-owned work item detail ─────────────────────────────────────────

const workItem = ref<WorkItem | null>(null)
const workItemLoading = ref(false)
const workItemUnavailable = ref(false)

async function fetchWorkItem() {
  const reference = rootSession.value?.workItem
  if (!reference) {
    workItem.value = null
    workItemUnavailable.value = false
    return
  }
  workItemLoading.value = true
  workItemUnavailable.value = false
  try {
    workItem.value = (await window.agentkeeper.workItems.get(reference)) ?? null
  } catch {
    workItem.value = null
    workItemUnavailable.value = true
  } finally {
    workItemLoading.value = false
  }
}

// ─── Linked plan ─────────────────────────────────────────────────────────────

const linkedPlan = ref<Plan | null>(null)
const planLoading = ref(false)
const resumingPlan = ref(false)

async function fetchLinkedPlan() {
  const projectPath = rootSession.value?.projectPath
  if (!projectPath) { linkedPlan.value = null; return }
  planLoading.value = true
  try {
    const allPlans = await window.agentkeeper.plans.list(projectPath)
    const agentIds = new Set([
      props.rootSessionId,
      ...(rootSession.value?.agents?.map(a => a.localId) ?? []),
    ])
    linkedPlan.value = allPlans.find(p => p.sessionIds.some(id => agentIds.has(id))) ?? null
  } catch {
    // Transient read errors (e.g. mid-write race) must not wipe the display —
    // leave the last known plan in place and let the next poll or event recover.
  } finally {
    planLoading.value = false
  }
}

function navigateToPlanStep(id: string, stepIndex: number) {
  void router.push({ path: `/planner/${id}`, query: { step: String(stepIndex) } })
}

let planPollTimer: ReturnType<typeof setInterval> | null = null

function isLinkedPlanRunning(): boolean {
  if (!linkedPlan.value) return false
  // Use plan-level status so the poll keeps running through the brief gap
  // between marking one step complete and the next step running.
  return linkedPlan.value.status === 'running'
}

function stopPlanPolling() {
  if (planPollTimer !== null) {
    clearInterval(planPollTimer)
    planPollTimer = null
  }
}

function startPlanPolling() {
  if (planPollTimer !== null || !isLinkedPlanRunning()) return
  planPollTimer = setInterval(async () => {
    await fetchLinkedPlan()
    if (!isLinkedPlanRunning()) stopPlanPolling()
  }, 2000)
}

const isPlanInterrupted = computed(() => {
  if (!linkedPlan.value || linkedPlan.value.status !== 'running') return false
  const interruptedStatuses: string[] = ['idle', 'suspended', 'error', 'inactive']
  return interruptedStatuses.includes(rootSession.value?.status ?? '')
})

async function resumePlanFromContext() {
  const session = rootSession.value
  if (!session) return
  resumingPlan.value = true
  try {
    await window.agentkeeper.sessions.resume(session.localId)
  } catch (err) {
    console.error('[ContextPanel] resumePlanFromContext failed:', err)
  } finally {
    resumingPlan.value = false
  }
}

function planStepStatusClass(status: string): string {
  switch (status) {
    case 'complete':    return 'text-emerald-500'
    case 'running':     return 'text-emerald-500'
    case 'failed':      return 'text-destructive'
    case 'skipped':     return 'text-muted-foreground/40'
    case 'replanning':  return 'text-amber-500'
    default:            return 'text-muted-foreground/40'
  }
}


function priorityClass(priority: string | undefined): string {
  switch (priority?.toLowerCase()) {
    case 'highest':
    case 'critical': return 'bg-destructive/15 text-destructive'
    case 'high':     return 'bg-orange-500/15 text-orange-500'
    case 'medium':   return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'low':      return 'bg-blue-500/15 text-blue-500'
    case 'lowest':
    case 'trivial':  return 'bg-muted text-muted-foreground'
    default:         return 'bg-muted text-muted-foreground'
  }
}

function priorityLabel(priority: string | undefined): string {
  if (!priority) return '?'
  // Abbreviate to one letter: High → H, Medium → M, Low → L, etc.
  return priority[0]?.toUpperCase() ?? '?'
}

// ─── Files changed (git diff stat) ───────────────────────────────────────────

const diffFiles = ref<GitDiffStatFile[]>([])
const diffLoading = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function fetchDiff() {
  const wt = rootSession.value?.worktreePath
  if (!wt) {
    diffFiles.value = []
    return
  }
  diffLoading.value = true
  try {
    diffFiles.value = await window.agentkeeper.worktrees.gitDiffStat(wt)
  } catch {
    // Non-fatal — leave previous results in place
  } finally {
    diffLoading.value = false
  }
}

function scheduleFetch() {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { void fetchDiff() }, 2000)
}

let unsubPlanUpdated: (() => void) | null = null

onMounted(async () => {
  if (rootSession.value?.worktreePath) void fetchDiff()
  void fetchWorkItem()
  await fetchLinkedPlan()
  startPlanPolling()
  unsubPlanUpdated = window.agentkeeper.plans.onUpdated(async ({ projectPath: p }) => {
    if (p !== rootSession.value?.projectPath) return
    await fetchLinkedPlan()
    startPlanPolling()
  })
})

onUnmounted(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  stopPlanPolling()
  unsubPlanUpdated?.()
})

// Re-fetch git diff ~2 s after the last activity tick
watch(() => rootSession.value?.lastActivityAt, (val, prev) => {
  if (val !== prev && rootSession.value?.worktreePath) scheduleFetch()
})

// Reset and re-fetch everything when the session changes (navigation)
watch(() => props.rootSessionId, async () => {
  stopPlanPolling()
  if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
  diffFiles.value = []
  workItem.value = null
  linkedPlan.value = null
  if (rootSession.value?.worktreePath) void fetchDiff()
  void fetchWorkItem()
  await fetchLinkedPlan()
  startPlanPolling()
})

function truncatePath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 3) return filePath
  return `…/${parts.slice(-3).join('/')}`
}

const reconnectingMcp = ref(false)

async function reconnectMcp() {
  if (!selectedAgent.value) return
  reconnectingMcp.value = true
  try {
    await window.agentkeeper.sessions.reconnectMcp(selectedAgent.value.localId)
  } catch (err) {
    console.error('[ContextPanel] reconnectMcp failed:', err)
  } finally {
    reconnectingMcp.value = false
  }
}
</script>

<template>
  <!-- Collapsed strip — just an expand button on the right edge -->
  <div
    v-if="collapsed"
    class="w-7 shrink-0 flex flex-col items-center pt-2 border-l border-border"
  >
    <button
      class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
      title="Expand context panel"
      @click="$emit('expand')"
    >
      <ChevronLeft class="size-3.5" />
    </button>
  </div>

  <!-- Expanded panel -->
  <div
    v-else
    class="w-[250px] shrink-0 flex flex-col border-l border-border overflow-hidden"
  >
    <!-- Panel header -->
    <div
      class="px-3 h-10 shrink-0 flex items-center justify-between border-b border-border bg-background z-10"
    >
      <span
        class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
      >
        <Layers class="size-3" />
        Context
      </span>
      <button
        class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
        title="Collapse context panel"
        @click="$emit('collapse')"
      >
        <ChevronRight class="size-3.5" />
      </button>
    </div>

    <!-- Scrollable sections -->
    <div class="flex-1 overflow-y-auto divide-y divide-border/40">

      <!-- ── SESSION ──────────────────────────────────────────────────────────── -->
      <section class="px-3 py-3">
        <div class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2">
          Session
        </div>

        <!-- Agent rows (only shown when there are multiple agents) -->
        <div v-if="agents.length > 1" class="mb-2.5 -mx-1">
          <button
            v-for="a in agents"
            :key="a.localId"
            class="w-full flex items-center gap-1.5 px-2 py-1 text-left rounded transition-colors"
            :class="a.localId === selectedId
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'"
            @click="$emit('update:selectedId', a.localId)"
          >
            <User2 v-if="isEntryPoint(a)" class="size-3 shrink-0 text-primary/80" />
            <CornerDownRight v-else class="size-3 shrink-0 ml-2 opacity-50" />
            <span class="flex-1 text-[11px] font-medium truncate">{{ rowLabel(a) }}</span>
            <span class="size-1.5 rounded-full shrink-0" :class="statusDotClass(a.status)" />
          </button>
        </div>

        <!-- Selected agent identity (name + subtitle) — only when there are sub-agents -->
        <div v-if="selectedAgent && agents.length > 1" class="mb-2.5">
          <div class="text-xs font-semibold text-foreground leading-snug">
            {{ agentName(selectedAgent) }}
          </div>
          <div class="text-[11px] text-muted-foreground truncate mt-0.5 leading-snug">
            {{ selectedAgent.isEntryPoint
              ? (rootSession?.title ?? rootSession?.agencyPrompt ?? selectedAgent.initialPrompt)
              : selectedAgent.initialPrompt }}
          </div>
        </div>

        <!-- Role name — standalone sessions only -->
        <div v-if="agents.length === 1 && selectedAgent?.roleName" class="flex items-center justify-between gap-2 mb-2">
          <span class="text-muted-foreground shrink-0 text-[11px]">Role</span>
          <span class="text-[11px] font-medium text-foreground truncate text-right">{{ selectedAgent.roleName }}</span>
        </div>

        <!-- Stats (for selected agent) -->
        <div class="space-y-1 text-[11px]">
          <!-- Status row — only when there are sub-agents (otherwise redundant with header badge) -->
          <div v-if="agents.length > 1 && selectedAgent" class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Status</span>
            <span class="font-medium flex items-center gap-1 truncate" :class="statusTextClass(selectedAgent.status)">
              <span class="size-1.5 rounded-full shrink-0" :class="statusDotClass(selectedAgent.status)" />
              {{ statusLabel(selectedAgent.status) }}
            </span>
          </div>
          <!-- Reconnect MCP button — shown for agency agents in error state that have an SDK session -->
          <div
            v-if="agents.length > 1 && selectedAgent?.status === 'error' && selectedAgent?.sdkSessionId && rootSession?.agencyId"
            class="pt-0.5"
          >
            <button
              class="w-full text-[11px] px-2 py-1 rounded bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
              :disabled="reconnectingMcp"
              @click="reconnectMcp"
            >
              {{ reconnectingMcp ? 'Reconnecting…' : 'Reconnect MCP' }}
            </button>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Model</span>
            <span class="font-mono text-primary truncate text-right">{{ resolvedLabelFor(rootSession?.model ?? null) }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Turns</span>
            <span class="tabular-nums text-foreground">{{ turnCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0 flex items-center gap-1">
              Tokens
              <TokenBreakdownPopover :session-id="props.rootSessionId" side="left" />
            </span>
            <span class="tabular-nums text-foreground">{{ tokens.toLocaleString() }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Cost</span>
            <span class="tabular-nums text-foreground">{{ formatCost(costUsd) }}</span>
          </div>
          <div class="flex items-start justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Started</span>
            <span class="text-foreground text-right">
              {{ selectedAgent ? formatRelativeTime(selectedAgent.startedAt) : '—' }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── WORK ITEM ─────────────────────────────────────────────────────── -->
      <section v-if="rootSession?.workItem" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <Tag class="size-3" />
          Work Item
        </div>

        <!-- Title — prefer fetched workItem title, fall back to session field -->
        <div class="text-[11px] font-medium text-foreground leading-snug mb-1.5">
          {{ workItem?.title ?? rootSession.workItem.title ?? rootSession.workItem.externalRef }}
        </div>
        <div v-if="workItemUnavailable" class="mb-2 text-[11px] text-amber-600 dark:text-amber-400">
          Provider not available
        </div>

        <!-- Key + priority badge -->
        <div class="flex items-center gap-1.5 mb-2">
          <span class="text-[11px] font-mono text-muted-foreground">
            {{ rootSession.workItem.externalRef }}
          </span>
          <span
            class="inline-flex items-center rounded px-1 py-0 text-[10px] font-medium"
            :class="workItem ? priorityClass(workItem.priority) : 'bg-muted text-muted-foreground'"
            :title="workItem?.priority ?? 'Priority unknown'"
          >
            {{ workItem ? priorityLabel(workItem.priority) : '?' }}
          </span>
        </div>

        <!-- Detail rows -->
        <div class="space-y-1 text-[11px]">
          <!-- Epic: parentRef if the issue is a story/task under an epic -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Epic</span>
            <span class="text-foreground font-mono truncate text-right">
              {{ workItem?.parentRef ?? '—' }}
            </span>
          </div>
          <!-- Sprint: not in WorkItem type; stays — until plugin exposes it -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Sprint</span>
            <span class="text-foreground">—</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Points</span>
            <span class="text-foreground tabular-nums">
              {{ workItem?.storyPoints ?? '—' }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── PLAN ─────────────────────────────────────────────────────────────── -->
      <section v-if="linkedPlan" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <ListTodo class="size-3" />
          Plan
          <span class="ml-auto font-normal normal-case tracking-normal text-muted-foreground">
            {{ linkedPlan.steps.filter(s => s.status === 'complete').length }}/{{ linkedPlan.steps.length }}
          </span>
        </div>

        <!-- Progress bar -->
        <div class="h-0.5 rounded-full bg-muted overflow-hidden mb-2.5">
          <div
            class="h-full rounded-full bg-emerald-500 transition-all duration-300"
            :style="{ width: `${linkedPlan.steps.length > 0 ? (linkedPlan.steps.filter(s => s.status === 'complete').length / linkedPlan.steps.length) * 100 : 0}%` }"
          />
        </div>

        <!-- Plan title -->
        <div class="text-[11px] font-medium text-foreground leading-snug mb-2 truncate" :title="linkedPlan.title">
          {{ linkedPlan.title }}
        </div>

        <!-- Step rows -->
        <div class="space-y-0.5">
          <button
            v-for="(step, index) in linkedPlan.steps"
            :key="step.id"
            class="w-full flex items-start gap-1.5 px-1.5 py-1 text-left rounded transition-colors hover:bg-muted/50 text-[11px]"
            :title="step.title"
            @click="navigateToPlanStep(linkedPlan.id, index)"
          >
            <span
              class="shrink-0 flex items-center justify-center w-3 mt-px"
              :class="[planStepStatusClass(step.status), step.status === 'running' ? 'animate-pulse' : '']"
            >
              <CircleCheckBig v-if="step.status === 'complete'" class="size-3" />
              <CircleIcon v-else class="size-3" />
            </span>
            <span
              class="flex-1 truncate leading-snug"
              :class="step.status === 'complete' ? 'text-muted-foreground line-through' : step.status === 'running' ? 'text-foreground font-medium' : 'text-muted-foreground'"
            >
              {{ step.title }}
            </span>
          </button>
        </div>

        <!-- Resume button — shown when plan is running but this session stopped -->
        <button
          v-if="isPlanInterrupted"
          class="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
          :disabled="resumingPlan"
          @click="resumePlanFromContext"
        >
          <Play v-if="!resumingPlan" class="size-3" />
          <Loader2 v-else class="size-3 animate-spin" />
          {{ resumingPlan ? 'Resuming…' : 'Resume plan' }}
        </button>
      </section>

      <!-- ── BRANCH & PR ─────────────────────────────────────────────────────── -->
      <section v-if="rootSession?.branch" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <GitBranch class="size-3" />
          Branch
        </div>

        <!-- Branch name always shown -->
        <div class="flex items-center gap-1.5 mb-2.5">
          <GitBranch class="size-3 shrink-0 text-muted-foreground" />
          <span class="text-[11px] font-mono text-foreground truncate">
            {{ rootSession.branch }}
          </span>
        </div>

      </section>

      <!-- ── FILES CHANGED ──────────────────────────────────────────────────── -->
      <section v-if="rootSession?.worktreePath" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <FileCode2 class="size-3" />
          Files Changed
          <span v-if="diffFiles.length > 0" class="ml-auto font-normal normal-case tracking-normal">
            · {{ diffFiles.length }}
          </span>
        </div>

        <!-- File rows -->
        <div v-if="diffFiles.length > 0" class="space-y-1">
          <div
            v-for="f in diffFiles"
            :key="f.file"
            class="flex items-center gap-1.5 text-[11px]"
            :title="f.file"
          >
            <span class="flex-1 text-foreground truncate font-mono">{{ truncatePath(f.file) }}</span>
            <span v-if="f.added > 0" class="text-emerald-500 tabular-nums shrink-0">+{{ f.added }}</span>
            <span v-if="f.removed > 0" class="text-destructive tabular-nums shrink-0">-{{ f.removed }}</span>
          </div>
        </div>

        <div v-else-if="diffLoading" class="text-[11px] text-muted-foreground/50 italic">
          Loading…
        </div>
        <div v-else class="text-[11px] text-muted-foreground/50 italic">
          No changes detected
        </div>
      </section>

    </div>
  </div>
</template>
