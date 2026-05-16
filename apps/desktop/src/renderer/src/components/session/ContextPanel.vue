<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Circle, CircleCheckBig, CornerDownRight, FileCode2, GitBranch, Layers, ListTodo, Loader2, Play, Tag, User2 } from 'lucide-vue-next'
import TokenBreakdownPopover from './TokenBreakdownPopover.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePluginHealth } from '@/composables/usePluginHealth'
import { formatRelativeTime, shortModel } from '@/lib/format'
import type { Agent, GitDiffStatFile, LiveSessionStatus, Plan } from '@shared/ipc-contract'
import type { WorkItem } from '@shared/ipc-contract'
import type { PRDetail } from '@shared/github-types'

const props = defineProps<{
  collapsed: boolean
  rootSessionId: string
  selectedId: string
}>()
defineEmits<{ collapse: []; expand: []; 'update:selectedId': [id: string] }>()

const store = useSessionStore()
const { projects } = useProjectsQuery()
const router = useRouter()

const { isHealthy: githubHealthy } = usePluginHealth('github')
const { isHealthy: jiraHealthy } = usePluginHealth('jira')

const rootSession = computed(() => store.getSession(props.rootSessionId))

// Repo slug ('owner/repo') from the project registry, used for PR lookups.
const githubRepo = computed(
  () => projects.value.find((p) => p.path === rootSession.value?.projectPath)?.repo ?? null,
)

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
    case 'terminated':
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
    case 'blocked':    return 'Blocked'
    case 'completed':  return 'Completed'
    case 'terminated': return 'Terminated'
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

function agentTokens(agentLocalId: string): number {
  return (
    (store.agentTokens[agentLocalId]?.tokens ?? 0) +
    (store.sessionRunTokens[agentLocalId] ?? 0) +
    (store.sessionOutputEstimates[agentLocalId] ?? 0)
  )
}

function agentName(a: Agent): string {
  if (isEntryPoint(a)) return a.roleName ?? 'Main agent'
  return a.roleName ?? 'Agent'
}

// ─── Derived stats ────────────────────────────────────────────────────────────

const turnCount = computed(() => {
  const agentEvts = rootSession.value?.agentEvents[props.selectedId] ?? []
  const fromEvents = agentEvts.filter((e) => e.kind === 'assistant').length
  const persisted = store.sessionTurns[props.rootSessionId] ?? 0
  return Math.max(fromEvents, persisted)
})

const tokens = computed(() => agentTokens(props.selectedId))
const costUsd = computed(() => store.agentTokens[props.selectedId]?.costUsd ?? 0)

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

// ─── PR card ─────────────────────────────────────────────────────────────────

const prDetail = ref<PRDetail | null>(null)
const prLoading = ref(false)

async function fetchPR() {
  const branch = rootSession.value?.branch
  const repo = githubRepo.value
  if (!branch || !repo || !githubHealthy.value) {
    prDetail.value = null
    return
  }
  prLoading.value = true
  try {
    const list = await window.agentkeeper.github.listPRs({ state: 'all', repo })
    const match = list.find((pr) => pr.headRef === branch)
    if (match) {
      prDetail.value = await window.agentkeeper.github.getPR(repo, match.number)
    } else {
      prDetail.value = null
    }
  } catch {
    prDetail.value = null
  } finally {
    prLoading.value = false
  }
}

function newPRUrl(): string {
  const repo = githubRepo.value
  const branch = rootSession.value?.branch
  if (!repo || !branch) return ''
  return `https://github.com/${repo}/compare/${branch}`
}

const prStateClass: Record<string, string> = {
  open:   'bg-green-500/20 text-green-400',
  closed: 'bg-red-500/20 text-red-400',
  merged: 'bg-purple-500/20 text-purple-400',
}

// ─── Jira ticket detail ───────────────────────────────────────────────────────

const workItem = ref<WorkItem | null>(null)
const workItemLoading = ref(false)

async function fetchWorkItem() {
  const key = rootSession.value?.workItemKey
  if (!key || !jiraHealthy.value) {
    workItem.value = null
    return
  }
  workItemLoading.value = true
  try {
    workItem.value = (await window.agentkeeper.workItems.get(key)) ?? null
  } catch {
    workItem.value = null
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

function navigateToPlanStep(filename: string, stepIndex: number) {
  void router.push({ path: `/planner/${filename}`, query: { step: String(stepIndex) } })
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
  const interruptedStatuses: string[] = ['idle', 'suspended', 'error', 'terminated']
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
  void fetchPR()
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
  prDetail.value = null
  workItem.value = null
  linkedPlan.value = null
  if (rootSession.value?.worktreePath) void fetchDiff()
  void fetchPR()
  void fetchWorkItem()
  await fetchLinkedPlan()
  startPlanPolling()
})

function truncatePath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 3) return filePath
  return `…/${parts.slice(-3).join('/')}`
}

// Electron intercepts window.open via setWindowOpenHandler → shell.openExternal.
function openUrl(url: string) {
  if (url) window.open(url, '_blank')
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
            <span class="font-mono text-primary truncate text-right">{{ shortModel(rootSession?.model ?? null) ?? '—' }}</span>
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

      <!-- ── JIRA TICKET ────────────────────────────────────────────────────── -->
      <section v-if="rootSession?.workItemKey" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <Tag class="size-3" />
          Jira Ticket
        </div>

        <!-- Title — prefer fetched workItem title, fall back to session field -->
        <div class="text-[11px] font-medium text-foreground leading-snug mb-1.5">
          {{ workItem?.title ?? rootSession.workItemTitle ?? rootSession.workItemKey }}
        </div>

        <!-- Key + priority badge -->
        <div class="flex items-center gap-1.5 mb-2">
          <span class="text-[11px] font-mono text-muted-foreground">
            {{ rootSession.workItemKey }}
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
            @click="navigateToPlanStep(linkedPlan.filename, index)"
          >
            <span
              class="shrink-0 flex items-center justify-center w-3 mt-px"
              :class="[planStepStatusClass(step.status), step.status === 'running' ? 'animate-pulse' : '']"
            >
              <CircleCheckBig v-if="step.status === 'complete'" class="size-3" />
              <Circle v-else class="size-3" />
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
          Branch &amp; PR
        </div>

        <!-- Branch name always shown -->
        <div class="flex items-center gap-1.5 mb-2.5">
          <GitBranch class="size-3 shrink-0 text-muted-foreground" />
          <span class="text-[11px] font-mono text-foreground truncate">
            {{ rootSession.branch }}
          </span>
        </div>

        <!-- PR card — GitHub plugin healthy + repo known + PR found -->
        <button
          v-if="githubHealthy && githubRepo && prDetail"
          class="w-full text-left rounded border border-border/60 px-2.5 py-2 hover:bg-muted/50 transition-colors"
          :title="`Open PR #${prDetail.number} on GitHub`"
          @click="openUrl(prDetail.url)"
        >
          <!-- State badge + number -->
          <div class="flex items-center gap-1.5 mb-1">
            <span
              class="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium"
              :class="prStateClass[prDetail.state] ?? 'bg-muted text-muted-foreground'"
            >
              {{ prDetail.state }}
            </span>
            <span class="text-[11px] text-muted-foreground">#{{ prDetail.number }}</span>
            <span v-if="prDetail.isDraft" class="text-[10px] text-muted-foreground italic">draft</span>
          </div>
          <!-- Title -->
          <div class="text-[11px] font-medium text-foreground leading-snug mb-1.5 line-clamp-2">
            {{ prDetail.title }}
          </div>
          <!-- Stats row -->
          <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span class="text-emerald-500">+{{ prDetail.additions }}</span>
            <span class="text-destructive">-{{ prDetail.deletions }}</span>
            <span>· {{ prDetail.changedFiles }} files</span>
          </div>
        </button>

        <!-- Loading state -->
        <div
          v-else-if="githubHealthy && githubRepo && prLoading"
          class="text-[11px] text-muted-foreground/50 italic"
        >
          Loading PR…
        </div>

        <!-- No PR found — show "Open pull request" button with pre-filled URL -->
        <button
          v-else-if="githubHealthy && githubRepo && !prLoading"
          class="text-[11px] text-primary hover:underline"
          :title="`Open pull request for ${rootSession.branch}`"
          @click="openUrl(newPRUrl())"
        >
          Open pull request ↗
        </button>
        <!-- If GitHub not configured, branch name alone is sufficient (no PR actions) -->
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
