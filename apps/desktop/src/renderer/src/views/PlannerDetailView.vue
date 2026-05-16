<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  RefreshCw,
  Play,
  Pause,
  X,
  Minus,
  MonitorPlay,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  Loader2,
  Check,
  MoreHorizontal,
  GitBranch,
  Zap,
  File,
} from 'lucide-vue-next'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionStore } from '@/stores/sessions'
import type { Plan, PlanStep, Session } from '@shared/ipc-contract'

const route = useRoute()
const router = useRouter()
const { focusedProject } = useProjectsQuery()
const sessionStore = useSessionStore()

const filename = computed(() => route.params.filename as string)
const plan = ref<Plan | null>(null)
const loading = ref(false)
const generating = ref(false)
const replanning = ref(false)
const replanError = ref<string | null>(null)
const starting = ref(false)
const resuming = ref(false)
const lastSession = ref<Session | null | undefined>(undefined)
// undefined = not yet loaded, null = session not found / deleted

// Which step indices are expanded
const expandedSteps = ref<Set<number>>(new Set())
// Which step has context menu open
const openMenuStep = ref<number | null>(null)

async function loadLastSession() {
  const ids = plan.value?.sessionIds
  if (!ids || ids.length === 0) { lastSession.value = null; return }
  const id = ids[ids.length - 1]!
  const project = focusedProject.value
  if (!project) { lastSession.value = null; return }

  // Live store first (includes agent data + up-to-date status)
  const live = sessionStore.getSession(id)
  if (live) { lastSession.value = live as Session; return }

  // Fall back to DB (persisted sessions after app restart)
  try {
    const all = await window.agentkeeper.sessions.listPersisted(project.path)
    lastSession.value = all.find(s => s.localId === id) ?? null
  } catch {
    lastSession.value = null
  }
}

async function loadPlan() {
  const project = focusedProject.value
  if (!project) return
  loading.value = true
  try {
    const result = await window.agentkeeper.plans.get(project.path, filename.value)
    if (result) {
      plan.value = result
      generating.value = false
      void loadLastSession()
    } else {
      generating.value = true
    }
  } finally {
    loading.value = false
  }
}

watch(filename, loadPlan, { immediate: true })

// Auto-expand a step when navigated to via ?step=N (e.g. from ContextPanel)
watch(
  () => route.query.step,
  (val) => {
    if (val === undefined || val === null) return
    const idx = parseInt(String(val), 10)
    if (!isNaN(idx) && idx >= 0) {
      expandedSteps.value.add(idx)
    }
  },
  { immediate: true },
)

// Reset orphaned running state: status=running but no sessions (e.g. after app restart)
watch(plan, (p) => {
  if (p && p.status === 'running' && p.sessionIds.length === 0 && focusedProject.value) {
    void window.agentkeeper.plans.update(focusedProject.value.path, filename.value, { status: 'planned' })
      .then((updated) => { if (updated) { plan.value = updated; void loadLastSession() } })
  }
}, { immediate: true })

// Live ingestion of Write tool events (plan appears before file hits disk)
let unsubEvent: (() => void) | null = null

function tryIngestWriteEvent(raw: unknown): void {
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
    if (!writePath?.endsWith(filename.value)) continue
    try {
      const data = JSON.parse(input['content'] as string) as Omit<Plan, 'filename' | 'filePath'>
      plan.value = { ...data, filename: filename.value, filePath: writePath }
      generating.value = false
    } catch { /* malformed — disk read will catch it */ }
    break
  }
}

onMounted(() => {
  unsubEvent = window.agentkeeper.sessions.onEvent((event) => {
    tryIngestWriteEvent(event.message)
  })
})

onUnmounted(() => {
  unsubEvent?.()
  unsubEvent = null
})

// ── Computed helpers ─────────────────────────────────────────────────────────

const planRef = computed(() => plan.value?.planRef ?? filename.value.replace(/-plan\.json$/, '').toUpperCase())

const totalMinutes = computed(() =>
  plan.value?.estimatedMinutes || plan.value?.steps.reduce((s, x) => s + x.estimatedMinutes, 0) || 0,
)

const completedMinutes = computed(() =>
  plan.value?.steps.reduce((s, x) => s + (x.actualMinutes ?? (x.status === 'complete' ? x.estimatedMinutes : 0)), 0) ?? 0,
)

const progressPercent = computed(() => {
  if (!plan.value?.steps.length) return 0
  const done = plan.value.steps.filter((s) => s.status === 'complete').length
  return Math.round((done / plan.value.steps.length) * 100)
})

const remainingMinutes = computed(() => {
  if (!totalMinutes.value) return 0
  return Math.max(0, totalMinutes.value - completedMinutes.value)
})

const distinctModels = computed(() => {
  if (!plan.value) return new Set<string>()
  return new Set(plan.value.steps.map((s) => s.model))
})

const isMixedModels = computed(() => distinctModels.value.size > 1)

const singleModel = computed(() =>
  isMixedModels.value ? null : ([...distinctModels.value][0] ?? null),
)

const parallelCount = computed(() =>
  plan.value?.steps.filter((s) => s.parallel).length ?? 0,
)

// Interrupted = plan marked running but last session has stopped
const isInterrupted = computed(() => {
  if (!plan.value || plan.value.status !== 'running') return false
  if (lastSession.value === undefined) return false
  if (lastSession.value === null) return true // deleted
  const stoppedStatuses: string[] = ['idle', 'completed', 'terminated', 'error', 'suspended']
  return stoppedStatuses.includes(lastSession.value.status)
})

const isSessionDeleted = computed(() => isInterrupted.value && lastSession.value === null)

const lastSessionId = computed(() => {
  const ids = plan.value?.sessionIds
  return ids && ids.length > 0 ? ids[ids.length - 1]! : null
})

// ── Formatters ───────────────────────────────────────────────────────────────

function fmt(total: number): string {
  if (!total) return '—'
  if (total < 60) return `${total}m`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

function fmtEst(total: number): string {
  return total ? `~${fmt(total)}` : '—'
}

// ── Step visuals ─────────────────────────────────────────────────────────────

function modelDotClass(model: string): string {
  if (model.includes('haiku')) return 'bg-green-500'
  if (model.includes('opus')) return 'bg-purple-500'
  if (model.includes('sonnet')) return 'bg-blue-500'
  return 'bg-muted-foreground'
}

function stepCircleClass(step: PlanStep): string {
  switch (step.status) {
    case 'complete':    return 'bg-green-500 border-green-500 text-white'
    case 'running':     return 'bg-background border-green-500 text-green-500'
    case 'failed':      return 'bg-destructive border-destructive text-white'
    case 'skipped':     return 'bg-muted border-muted text-muted-foreground'
    case 'replanning':  return 'bg-amber-500 border-amber-500 text-white'
    default:            return 'bg-background border-border text-muted-foreground'
  }
}

function connectorClass(step: PlanStep): string {
  switch (step.status) {
    case 'complete':   return 'bg-green-500'
    case 'running':    return 'bg-green-500/40'
    case 'replanning': return 'bg-amber-500/40'
    default:           return 'bg-border'
  }
}

function stepCardBorderClass(step: PlanStep): string {
  switch (step.status) {
    case 'running':    return 'border-l-2 border-l-green-500'
    case 'failed':     return 'border-l-2 border-l-destructive'
    case 'replanning': return 'border-l-2 border-l-amber-500'
    default:           return ''
  }
}

function toggleStep(index: number) {
  if (expandedSteps.value.has(index)) {
    expandedSteps.value.delete(index)
  } else {
    expandedSteps.value.add(index)
  }
}

function toggleMenu(index: number, event: MouseEvent) {
  event.stopPropagation()
  openMenuStep.value = openMenuStep.value === index ? null : index
}

function closeMenu() {
  openMenuStep.value = null
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function startAllSteps() {
  if (!plan.value || !focusedProject.value) return
  const project = focusedProject.value
  const cur = plan.value
  starting.value = true
  const stepsText = cur.steps
    .map((s, i) => {
      const lines = [
        `${i + 1}. ${s.title} — ${s.summary}`,
        `   Instructions: ${s.instructions}`,
      ]
      if (s.filesInScope?.length) {
        lines.push(`   Files in scope: ${s.filesInScope.join(', ')}`)
      }
      return lines.join('\n')
    })
    .join('\n')
  const prompt = `Execute the following implementation plan step by step.

Plan: ${cur.title} (${cur.externalRef})

Steps:
${stepsText}

Execute each step in sequence (run parallel:true steps concurrently where safe). Mark steps complete as you finish each one using the update_plan MCP tool.`
  try {
    const updated = await window.agentkeeper.plans.update(project.path, filename.value, { status: 'running' })
    if (updated) plan.value = updated
    const localId = await sessionStore.start({
      projectPath: project.path,
      initialPrompt: prompt,
      workItemId: cur.workItemId || undefined,
    })
    // record session on the plan so we can navigate back to it
    const withSession = await window.agentkeeper.plans.update(project.path, filename.value, {
      sessionIds: [...(plan.value?.sessionIds ?? []), localId],
    })
    if (withSession) plan.value = withSession
    void router.push('/sessions')
  } catch (err) {
    console.error('Failed to start plan:', err)
    await window.agentkeeper.plans.update(project.path, filename.value, { status: 'planned' }).catch(() => {})
    if (plan.value) plan.value = { ...plan.value, status: 'planned' }
  } finally {
    starting.value = false
  }
}

async function resetToPlanned() {
  if (!plan.value || !focusedProject.value) return
  const updated = await window.agentkeeper.plans.update(
    focusedProject.value.path,
    filename.value,
    { status: 'planned' },
  )
  if (updated) plan.value = updated
}

async function resumePlanSession() {
  if (!plan.value || !focusedProject.value || !lastSessionId.value) return
  const project = focusedProject.value
  resuming.value = true
  try {
    // Get the entry agent's sdkSessionId to resume the conversation history
    const agents = await window.agentkeeper.sessions.getAgents(lastSessionId.value)
    const entryAgent = agents.find(a => a.isEntryPoint) ?? agents[0] ?? null
    const sdkId = entryAgent?.sdkSessionId ?? undefined

    const newLocalId = await sessionStore.start({
      projectPath: project.path,
      initialPrompt: 'Resume the plan from the last completed step.',
      resumeSdkSessionId: sdkId,
      workItemId: plan.value.workItemId || undefined,
    })
    const updated = await window.agentkeeper.plans.update(project.path, filename.value, {
      sessionIds: [...(plan.value.sessionIds ?? []), newLocalId],
      status: 'running',
    })
    if (updated) plan.value = updated
    void router.push('/sessions')
  } catch (err) {
    console.error('Failed to resume plan:', err)
  } finally {
    resuming.value = false
  }
}

async function startNewPlanSession() {
  if (!plan.value || !focusedProject.value) return
  const project = focusedProject.value
  const cur = plan.value

  // Only send incomplete steps (not complete or skipped)
  const incompleteSteps = cur.steps.filter(s => s.status !== 'complete' && s.status !== 'skipped')
  const stepsText = incompleteSteps
    .map((s, i) => {
      const lines = [
        `${i + 1}. ${s.title} — ${s.summary ?? s.title}`,
        `   Instructions: ${s.instructions ?? s.title}`,
      ]
      if (s.filesInScope?.length) {
        lines.push(`   Files in scope: ${s.filesInScope.join(', ')}`)
      }
      return lines.join('\n')
    })
    .join('\n')

  const prompt = `Execute the following remaining implementation plan steps.

Plan: ${cur.title} (${cur.externalRef})
Note: Some earlier steps have already been completed. Resume from the first step below.

Remaining Steps:
${stepsText}

Execute each step in sequence. Mark steps complete using the update_plan MCP tool.`

  starting.value = true
  try {
    const updated = await window.agentkeeper.plans.update(project.path, filename.value, { status: 'running' })
    if (updated) plan.value = updated
    const newLocalId = await sessionStore.start({
      projectPath: project.path,
      initialPrompt: prompt,
      workItemId: cur.workItemId || undefined,
    })
    const withSession = await window.agentkeeper.plans.update(project.path, filename.value, {
      sessionIds: [...(plan.value?.sessionIds ?? []), newLocalId],
    })
    if (withSession) plan.value = withSession
    void router.push('/sessions')
  } catch (err) {
    console.error('Failed to start new plan session:', err)
    await window.agentkeeper.plans.update(project.path, filename.value, { status: 'planned' }).catch(() => {})
    if (plan.value) plan.value = { ...plan.value, status: 'planned' }
  } finally {
    starting.value = false
  }
}

async function replan() {
  if (!plan.value) return
  const project = focusedProject.value
  if (!project) return
  replanError.value = null
  replanning.value = true
  generating.value = true
  const cur = plan.value
  const now = new Date().toISOString()
  const prompt = `Analyze this ticket and create a detailed implementation plan.
Ticket: ${cur.externalRef} — ${cur.title}

Create .agentkeeper/plans/ if needed, then write the plan to .agentkeeper/plans/${cur.externalRef}-plan.json.

The file must be valid JSON with this structure:
{
  "title": "${cur.externalRef}: ${cur.title}",
  "externalRef": "${cur.externalRef}",
  "workItemId": "${cur.workItemId}",
  "status": "planned",
  "createdAt": "${now}",
  "updatedAt": "${now}",
  "sessionIds": [],
  "estimatedMinutes": <sum of all step estimatedMinutes>,
  "steps": [
    {
      "id": 1,
      "title": "concise actionable step title",
      "summary": "one-line description of what this step does",
      "instructions": "detailed instructions for the agent",
      "filesInScope": ["path/to/relevant/file.ts"],
      "model": "claude-haiku-4-5",
      "estimatedMinutes": 10,
      "agent": "explorer",
      "parallel": false,
      "status": "pending"
    }
  ]
}

- model: haiku for reads/audits, sonnet for implementation, opus for architecture
- agent: explorer | main | qa | doc
- parallel: true if safely concurrent with adjacent steps
- Aim for 4-8 focused concrete steps`
  try {
    await sessionStore.start({
      projectPath: project.path,
      workItemId: cur.workItemId,
      initialPrompt: prompt,
    })
  } catch (err) {
    replanError.value = err instanceof Error ? err.message : String(err)
    generating.value = false
  } finally {
    replanning.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-background" @click="closeMenu">
    <!-- Initial load spinner -->
    <div v-if="loading" class="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      <Loader2 class="size-4 animate-spin mr-2" /> Loading…
    </div>

    <!-- Generating (no plan yet) -->
    <div v-else-if="generating && !plan" class="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <Loader2 class="size-5 animate-spin" />
      <span class="font-medium">Generating plan…</span>
      <span class="text-xs opacity-60">Claude is writing the plan. It will appear here automatically.</span>
    </div>

    <!-- Plan not found -->
    <div v-else-if="!plan" class="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <span>Plan not found.</span>
      <button class="text-xs text-primary hover:underline" @click="void router.push('/planner')">
        Back to Planner
      </button>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="shrink-0 px-6 pt-5 pb-4">
        <!-- Breadcrumb + actions row -->
        <div class="flex items-start justify-between gap-4 mb-1">
          <div class="flex items-center gap-2">
            <button
              class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors -ml-1"
              @click="void router.push('/planner')"
            >
              <ArrowLeft :size="15" />
            </button>
            <span class="text-xs text-muted-foreground font-mono">PLAN · {{ planRef }}</span>
          </div>

          <!-- Context-sensitive action buttons -->
          <div class="flex items-center gap-2 shrink-0">
            <span v-if="replanError" class="text-xs text-destructive max-w-48 truncate">{{ replanError }}</span>

            <!-- Running state, session active: Open session + Pause -->
            <template v-if="plan.status === 'running' && plan.sessionIds.length > 0 && !isInterrupted">
              <button
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                @click="void router.push('/sessions')"
              >
                <MonitorPlay :size="14" />
                Open session
              </button>
              <button
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                @click="resetToPlanned"
              >
                <Pause :size="14" />
                Pause
              </button>
            </template>

            <!-- Running state, session interrupted — existing session: Resume -->
            <template v-else-if="isInterrupted && !isSessionDeleted">
              <button
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="resuming"
                @click="resumePlanSession"
              >
                <Loader2 v-if="resuming" :size="14" class="animate-spin" />
                <Play v-else :size="14" />
                {{ resuming ? 'Resuming…' : 'Resume session' }}
              </button>
              <button
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                @click="resetToPlanned"
              >
                <Pause :size="14" />
                Reset
              </button>
            </template>

            <!-- Running state, session deleted: Start new session -->
            <template v-else-if="isInterrupted && isSessionDeleted">
              <button
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                :disabled="starting"
                @click="startNewPlanSession"
              >
                <Loader2 v-if="starting" :size="14" class="animate-spin" />
                <Play v-else :size="14" />
                {{ starting ? 'Starting…' : 'Start new session' }}
              </button>
              <button
                class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                @click="resetToPlanned"
              >
                <X :size="14" />
                Reset
              </button>
            </template>

            <!-- Idle/planned state: Start all steps -->
            <button
              v-if="plan.status === 'planned'"
              class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="starting"
              @click="startAllSteps"
            >
              <Loader2 v-if="starting" :size="14" class="animate-spin" />
              <Play v-else :size="14" />
              {{ starting ? 'Starting…' : 'Start all steps' }}
            </button>

            <!-- Complete state: Open session -->
            <button
              v-if="plan.status === 'complete'"
              class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
              @click="void router.push('/sessions')"
            >
              <MonitorPlay :size="14" />
              Open session
            </button>

            <!-- Re-plan (all states except drafting mid-regen show it) -->
            <button
              class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              :disabled="replanning"
              @click="replan"
            >
              <RefreshCw :size="14" :class="replanning ? 'animate-spin' : ''" />
              {{ replanning ? 'Planning…' : 'Re-plan' }}
            </button>

            <button
              class="size-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              @click="void router.push('/planner')"
            >
              <X :size="15" />
            </button>
          </div>
        </div>

        <h1 class="text-2xl font-bold tracking-tight">{{ plan.title }}</h1>
      </div>

      <!-- Regenerating banner -->
      <div
        v-if="generating"
        class="shrink-0 flex items-center gap-2 mx-6 mb-3 px-3 py-2 bg-primary/5 border border-primary/20 rounded-md text-xs text-primary"
      >
        <Loader2 class="size-3 animate-spin shrink-0" />
        Regenerating plan — will update automatically when Claude finishes writing…
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-6 flex flex-col gap-4">
        <!-- Stats card -->
        <div class="rounded-lg border border-border overflow-hidden">
          <div class="grid grid-cols-6 divide-x divide-border">
            <!-- STATUS -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Status</p>
              <span
                class="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium"
                :class="{
                  'bg-green-500/15 text-green-600 dark:text-green-400': plan.status === 'running',
                  'border border-border text-muted-foreground': plan.status === 'planned',
                  'bg-amber-500/15 text-amber-600 dark:text-amber-400': plan.status === 'drafting',
                  'bg-purple-500/10 text-purple-600 dark:text-purple-400': plan.status === 'complete',
                }"
              >
                <span
                  v-if="plan.status === 'running'"
                  class="size-1.5 rounded-full bg-green-500 animate-pulse"
                />
                {{
                  plan.status === 'planned' ? 'Idle' :
                  plan.status === 'drafting' ? 'Planning' :
                  plan.status === 'running' ? 'Running' : 'Idle'
                }}
              </span>
            </div>

            <!-- PLANNING MODEL -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Planning Model</p>
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full shrink-0" :class="modelDotClass(singleModel ?? 'sonnet')" />
                <span class="text-sm font-mono">{{ singleModel ?? 'mixed' }}</span>
              </div>
            </div>

            <!-- TICKETS -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Tickets</p>
              <router-link
                v-if="plan.workItemId"
                :to="`/jira/issue/${plan.workItemId}`"
                class="text-sm px-2 py-0.5 rounded-md border border-border font-mono bg-background hover:bg-muted/60 transition-colors"
              >
                {{ plan.externalRef || plan.workItemId }}
              </router-link>
              <span v-else class="text-sm px-2 py-0.5 rounded-md border border-border font-mono bg-background text-muted-foreground">—</span>
            </div>

            <!-- ESTIMATED -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Estimated</p>
              <span class="text-sm font-semibold">{{ totalMinutes ? fmt(totalMinutes) : '—' }}</span>
            </div>

            <!-- REMAINING / ELAPSED -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">
                {{ plan.status === 'complete' ? 'Elapsed' : 'Remaining' }}
              </p>
              <span class="text-sm font-semibold">
                {{ plan.status === 'complete' ? fmt(completedMinutes) : (totalMinutes ? fmt(remainingMinutes) : '—') }}
              </span>
            </div>

            <!-- PROGRESS -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Progress</p>
              <div v-if="plan.status === 'drafting'" class="text-sm text-muted-foreground italic">drafting…</div>
              <div v-else class="flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full bg-muted overflow-hidden min-w-[80px]">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="plan.status === 'complete' ? 'bg-purple-500' : 'bg-green-500'"
                    :style="{ width: `${progressPercent}%` }"
                  />
                </div>
                <span class="text-sm font-semibold tabular-nums shrink-0">{{ progressPercent }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Prompt -->
        <div v-if="plan.prompt" class="rounded-lg border border-border px-4 py-3">
          <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Prompt</p>
          <p class="text-sm italic text-foreground/80">{{ plan.prompt }}</p>
        </div>

        <!-- Steps -->
        <div>
          <!-- Steps header -->
          <div class="flex items-center justify-between mb-3">
            <div class="flex items-baseline gap-2">
              <span class="text-sm font-semibold">STEPS · {{ plan.steps.length }}</span>
              <span class="text-xs text-muted-foreground">
                <span v-if="parallelCount > 0">steps marked parallel run as sub-agents simultaneously</span>
              </span>
            </div>
            <button class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Plus :size="13" />
              Add step
            </button>
          </div>

          <!-- Step list with timeline -->
          <div class="flex flex-col">
            <div
              v-for="(step, index) in plan.steps"
              :key="step.id"
              class="flex gap-3"
            >
              <!-- Timeline column -->
              <div class="flex flex-col items-center shrink-0">
                <!-- Circle + optional pulse halo -->
                <div class="relative flex items-center justify-center shrink-0">
                  <span
                    v-if="step.status === 'running'"
                    class="absolute inset-0 rounded-full bg-green-500/25 animate-ping"
                  />
                  <div
                    class="size-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold z-10"
                    :class="stepCircleClass(step)"
                  >
                    <Loader2   v-if="step.status === 'running'"    :size="12" class="animate-spin" />
                    <Check     v-else-if="step.status === 'complete'"  :size="13" />
                    <X         v-else-if="step.status === 'failed'"    :size="13" />
                    <Minus     v-else-if="step.status === 'skipped'"   :size="13" />
                    <RefreshCw v-else-if="step.status === 'replanning'" :size="11" class="animate-spin" />
                    <span      v-else>{{ step.id }}</span>
                  </div>
                </div>
                <!-- Connector line -->
                <div
                  v-if="index < plan.steps.length - 1"
                  class="w-0.5 flex-1 min-h-[16px]"
                  :class="connectorClass(step)"
                />
              </div>

              <!-- Card -->
              <div
                class="flex-1 mb-2 rounded-lg border border-border bg-card overflow-hidden"
                :class="stepCardBorderClass(step)"
              >
                <!-- Card header (always visible, clickable) -->
                <div
                  class="flex items-center gap-2 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors select-none"
                  @click="toggleStep(index)"
                >
                  <!-- Expand chevron -->
                  <component
                    :is="expandedSteps.has(index) ? ChevronDown : ChevronRight"
                    :size="14"
                    class="shrink-0 text-muted-foreground"
                  />

                  <!-- Title -->
                  <span class="flex-1 text-sm font-semibold min-w-0 truncate">{{ step.title }}</span>

                  <!-- Running badge -->
                  <span
                    v-if="step.status === 'running'"
                    class="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
                  >
                    running…
                  </span>
                  <span
                    v-else-if="step.status === 'skipped'"
                    class="shrink-0 text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground"
                  >
                    skipped
                  </span>

                  <!-- Reorder + menu -->
                  <div class="flex items-center gap-0.5 shrink-0" @click.stop>
                    <button
                      class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
                      :disabled="index === 0"
                    >
                      <ChevronUp :size="13" />
                    </button>
                    <button
                      class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
                      :disabled="index === (plan?.steps.length ?? 1) - 1"
                    >
                      <ChevronDown :size="13" />
                    </button>
                    <div class="relative">
                      <button
                        class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        @click="toggleMenu(index, $event)"
                      >
                        <MoreHorizontal :size="13" />
                      </button>
                      <!-- Context menu -->
                      <div
                        v-if="openMenuStep === index"
                        class="absolute right-0 top-full mt-1 w-48 rounded-lg border border-border bg-popover shadow-lg z-50 py-1 text-sm"
                        @click.stop
                      >
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                          <RefreshCw :size="13" class="text-muted-foreground shrink-0" />
                          Re-plan this step
                        </button>
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                          <GitBranch :size="13" class="text-muted-foreground shrink-0" />
                          Run in parallel
                        </button>
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                          <Zap :size="13" class="text-muted-foreground shrink-0" />
                          Change model
                        </button>
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                          <Play :size="13" class="text-muted-foreground shrink-0" />
                          Run only this step
                        </button>
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                          <X :size="13" class="text-muted-foreground shrink-0" />
                          Skip step
                        </button>
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left">
                          <File :size="13" class="text-muted-foreground shrink-0" />
                          Attach context
                        </button>
                        <div class="my-1 border-t border-border" />
                        <button class="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/60 transition-colors text-left text-destructive">
                          <X :size="13" class="shrink-0" />
                          Remove step
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Meta row -->
                <div class="flex items-center gap-1.5 px-4 pb-2.5 text-xs text-muted-foreground flex-wrap">
                  <span class="size-2 rounded-full shrink-0" :class="modelDotClass(step.model)" />
                  <span class="font-mono">{{ step.model }}</span>
                  <span class="text-border">·</span>
                  <span>{{ fmtEst(step.estimatedMinutes) }}</span>
                  <template v-if="step.actualMinutes != null">
                    <span class="text-border">·</span>
                    <span>actual {{ fmt(step.actualMinutes) }}</span>
                  </template>
                  <span class="text-border">·</span>
                  <span>agent {{ step.agent }}</span>
                  <template v-if="step.filesInScope?.length">
                    <span class="text-border">·</span>
                    <span class="flex items-center gap-0.5">
                      <File :size="10" />
                      {{ step.filesInScope.length }}
                    </span>
                  </template>
                  <span
                    v-if="step.parallel"
                    class="ml-0.5 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 text-[10px] flex items-center gap-1"
                  >
                    <GitBranch :size="9" />
                    parallel
                  </span>
                </div>

                <!-- Expanded content -->
                <div v-if="expandedSteps.has(index)" class="border-t border-border px-4 py-3 space-y-3">
                  <!-- Summary -->
                  <div v-if="step.summary">
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Summary</p>
                    <p class="text-sm">{{ step.summary }}</p>
                  </div>
                  <!-- Full instructions -->
                  <div v-if="step.instructions">
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Full Instructions</p>
                    <p class="text-sm text-foreground/80 leading-relaxed">{{ step.instructions }}</p>
                  </div>
                  <!-- Files in scope -->
                  <div v-if="step.filesInScope?.length">
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1.5">
                      Files in Scope · {{ step.filesInScope.length }}
                    </p>
                    <div class="space-y-1">
                      <div
                        v-for="f in step.filesInScope"
                        :key="f"
                        class="flex items-center gap-1.5 text-xs text-muted-foreground"
                      >
                        <File :size="11" class="shrink-0" />
                        <span class="font-mono">{{ f }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Step action buttons -->
                  <div class="flex items-center gap-2 pt-1 flex-wrap">
                    <button class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors">
                      <RefreshCw :size="11" />
                      Re-plan
                    </button>
                    <button class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors">
                      <GitBranch :size="11" />
                      Run in parallel
                    </button>
                    <button class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors">
                      <Play :size="11" />
                      Run only this
                    </button>
                    <button class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors">
                      <X :size="11" />
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
