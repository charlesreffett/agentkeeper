<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
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
  Shield,
  Pencil,
  MessageSquare,
} from 'lucide-vue-next'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSessionStore } from '@/stores/sessions'
import type { Plan, PlanStep, PlanStepStatus, Session } from '@shared/ipc-contract'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
// Which step's action dropdown is open (controlled so re-renders don't auto-close it)
const openStepDropdownIndex = ref<number | null>(null)
// Inline editing state
const editingStep = ref<{ index: number; field: 'title' | 'instructions' } | null>(null)
const editingValue = ref('')

// Per-step context editor state
const editingContext = ref<number | null>(null)
const contextValue = ref('')


async function loadLastSession() {
  const ids = plan.value?.sessionIds
  if (!ids || ids.length === 0) { lastSession.value = null; return }
  const id = ids[ids.length - 1]!
  const project = focusedProject.value
  if (!project) { lastSession.value = null; return }

  const live = sessionStore.getSession(id)
  if (live) { lastSession.value = live as Session; return }

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

// Auto-expand a step when navigated to via ?step=N
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

// Reset orphaned running state after app restart
watch(plan, (p) => {
  if (p && p.status === 'running' && p.sessionIds.length === 0 && focusedProject.value) {
    void window.agentkeeper.plans.update(focusedProject.value.path, filename.value, { status: 'planned' })
      .then((updated) => { if (updated) { plan.value = updated; void loadLastSession() } })
  }
}, { immediate: true })

// Live ingestion of Write tool events (plan appears before file hits disk)
let unsubEvent: (() => void) | null = null
let unsubPlanUpdated: (() => void) | null = null

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
  unsubPlanUpdated = window.agentkeeper.plans.onUpdated(async ({ projectPath: p, filename: f }) => {
    const project = focusedProject.value
    if (!project || p !== project.path || f !== filename.value) return
    const fresh = await window.agentkeeper.plans.get(p, f)
    if (fresh) {
      plan.value = fresh
      generating.value = false
      void loadLastSession()
    }
  })
})

onUnmounted(() => {
  unsubEvent?.()
  unsubEvent = null
  unsubPlanUpdated?.()
  unsubPlanUpdated = null
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

const isInterrupted = computed(() => {
  if (!plan.value || plan.value.status !== 'running') return false
  if (lastSession.value === undefined) return false
  if (lastSession.value === null) return true
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

// ── Step mutation helpers ─────────────────────────────────────────────────────

async function persistSteps(steps: PlanStep[]) {
  if (!focusedProject.value) return
  // JSON round-trip strips Vue reactive Proxy wrappers — contextBridge cannot serialize Proxy objects
  const rawSteps = JSON.parse(JSON.stringify(steps)) as PlanStep[]
  const updated = await window.agentkeeper.plans.update(focusedProject.value.path, filename.value, { steps: rawSteps })
  if (updated) {
    plan.value = updated
  } else {
    console.error('[PlannerDetailView] persistSteps: update returned null — plan file may not exist at', focusedProject.value.path)
  }
}

async function moveStep(index: number, dir: -1 | 1) {
  if (!plan.value) return
  const steps = [...plan.value.steps]
  const target = index + dir
  if (target < 0 || target >= steps.length) return
  ;[steps[index], steps[target]] = [steps[target]!, steps[index]!]
  await persistSteps(steps.map((s, i) => ({ ...s, id: i + 1 })))
}

async function toggleApproval(index: number) {
  if (!plan.value) return
  await persistSteps(
    plan.value.steps.map((s, i) =>
      i === index ? { ...s, requiresApproval: !s.requiresApproval } : s,
    ),
  )
}

async function toggleParallel(index: number) {
  if (!plan.value) return
  await persistSteps(
    plan.value.steps.map((s, i) =>
      i === index ? { ...s, parallel: !s.parallel } : s,
    ),
  )
}

async function skipStep(index: number) {
  if (!plan.value) return
  const step = plan.value.steps[index]
  if (!step) return
  const next: PlanStepStatus = step.status === 'skipped' ? 'pending' : 'skipped'
  await persistSteps(
    plan.value.steps.map((s, i) => i === index ? { ...s, status: next } : s),
  )
}

async function removeStep(index: number) {
  if (!plan.value) return
  await persistSteps(
    plan.value.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, id: i + 1 })),
  )
}

async function addStep() {
  if (!plan.value) return
  const newStep: PlanStep = {
    id: plan.value.steps.length + 1,
    title: 'New step',
    summary: '',
    instructions: '',
    filesInScope: [],
    model: 'claude-sonnet-4-5',
    estimatedMinutes: 15,
    agent: 'main',
    parallel: false,
    status: 'pending',
  }
  const steps = [...plan.value.steps, newStep]
  await persistSteps(steps)
  const newIndex = steps.length - 1
  expandedSteps.value.add(newIndex)
  await nextTick()
  startEdit(newIndex, 'title')
}

// ── Inline editing ────────────────────────────────────────────────────────────

function startEdit(index: number, field: 'title' | 'instructions') {
  const step = plan.value?.steps[index]
  if (!step) return
  editingStep.value = { index, field }
  editingValue.value = field === 'title' ? step.title : (step.instructions ?? '')
}

async function commitEdit() {
  const editing = editingStep.value
  if (!editing || !plan.value) { editingStep.value = null; return }
  const { index, field } = editing
  editingStep.value = null
  if (!editingValue.value.trim()) return
  await persistSteps(
    plan.value.steps.map((s, i) =>
      i === index ? { ...s, [field]: editingValue.value.trim() } : s,
    ),
  )
}

// ── Context injection ─────────────────────────────────────────────────────────

function openContextEditor(index: number) {
  editingContext.value = index
  contextValue.value = plan.value?.steps[index]?.context ?? ''
  expandedSteps.value.add(index)
}

async function saveContext(index: number) {
  if (!plan.value) { editingContext.value = null; return }
  editingContext.value = null
  await persistSteps(
    plan.value.steps.map((s, i) =>
      i === index ? { ...s, context: contextValue.value.trim() || undefined } : s,
    ),
  )
}

// ── Prompt builder helper ─────────────────────────────────────────────────────

function buildStepsText(steps: PlanStep[]): { text: string; hasGates: boolean } {
  let hasGates = false
  const text = steps
    .map((s, i) => {
      const lines = [
        `${i + 1}. ${s.title} — ${s.summary ?? s.title}`,
        `   Instructions: ${s.instructions ?? s.title}`,
      ]
      if (s.filesInScope?.length) lines.push(`   Files in scope: ${s.filesInScope.join(', ')}`)
      if (s.context) lines.push(`   Additional context: ${s.context}`)
      if (s.requiresApproval) {
        hasGates = true
        lines.push(`   ⚠ Approval gate: mark this step complete, set plan status="planned", then stop`)
      }
      return lines.join('\n')
    })
    .join('\n')
  return { text, hasGates }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function startAllSteps() {
  if (!plan.value || !focusedProject.value) return
  const project = focusedProject.value
  const cur = plan.value
  starting.value = true
  const { text: stepsText, hasGates } = buildStepsText(cur.steps)
  const gateNote = hasGates
    ? '\n\nIMPORTANT: Steps marked with ⚠ Approval gate require you to stop after completing them. Mark the step complete, call update_plan with status="planned", then stop. The user will review and manually resume.'
    : ''
  const prompt = `Execute the following implementation plan step by step.

Plan: ${cur.title} (${cur.externalRef})

Steps:
${stepsText}

Execute each step in sequence (run parallel:true steps concurrently where safe). Mark steps complete as you finish each one using the update_plan MCP tool.${gateNote}`
  try {
    const updated = await window.agentkeeper.plans.update(project.path, filename.value, { status: 'running' })
    if (updated) plan.value = updated
    const localId = await sessionStore.start({
      projectPath: project.path,
      initialPrompt: prompt,
      workItemId: cur.workItemId || undefined,
    })
    const withSession = await window.agentkeeper.plans.update(project.path, filename.value, {
      sessionIds: [...(plan.value?.sessionIds ?? []), localId],
    })
    if (withSession) plan.value = withSession
    void router.push(`/sessions/${localId}`)
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
  if (!plan.value || !focusedProject.value || !lastSessionId.value || !lastSession.value) return
  resuming.value = true
  try {
    sessionStore.openPersisted(lastSession.value as Session)
    await window.agentkeeper.sessions.resume(lastSessionId.value)
    void router.push(`/sessions/${lastSessionId.value}`)
  } catch (err) {
    console.error('Failed to resume plan session:', err)
  } finally {
    resuming.value = false
  }
}

async function startNewPlanSession() {
  if (!plan.value || !focusedProject.value) return
  const project = focusedProject.value
  const cur = plan.value

  const incompleteSteps = cur.steps.filter(s => s.status !== 'complete' && s.status !== 'skipped')
  const { text: stepsText, hasGates } = buildStepsText(incompleteSteps)
  const gateNote = hasGates
    ? '\n\nIMPORTANT: Steps marked with ⚠ Approval gate require you to stop after completing them. Mark the step complete, call update_plan with status="planned", then stop. The user will review and manually resume.'
    : ''
  const prompt = `Execute the following remaining implementation plan steps.

Plan: ${cur.title} (${cur.externalRef})
Note: Some earlier steps have already been completed. Resume from the first step below.

Remaining Steps:
${stepsText}

Execute each step in sequence. Mark steps complete using the update_plan MCP tool.${gateNote}`

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
    void router.push(`/sessions/${newLocalId}`)
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
  const existingSteps = cur.steps.map(s => `  [${s.id}] ${s.title}`).join('\n')
  const prompt = `Revise the steps of an existing plan. Do NOT call create_plan — the file already exists and must not be recreated.

Plan: ${cur.externalRef} — ${cur.title}
Original prompt (must not change): "${cur.prompt ?? ''}"
Current steps:
${existingSteps}

Call update_plan with filename "${cur.filename}" to replace the steps with a better set.

The patch must have exactly this structure (no other top-level keys):
{
  "status": "planned",
  "updatedAt": "${now}",
  "estimatedMinutes": <sum of all step estimatedMinutes>,
  "steps": [
    {
      "id": 1,
      "title": "concise actionable step title",
      "summary": "one-line description of what this step does",
      "instructions": "detailed instructions for the agent executing this step",
      "filesInScope": ["path/to/relevant/file.ts"],
      "model": "claude-haiku-4-5",
      "estimatedMinutes": 10,
      "agent": "main",
      "parallel": false,
      "status": "pending"
    }
  ]
}

Guidelines:
- model: haiku for reads/audits, sonnet for implementation, opus for architecture
- agent: explorer | main | qa | doc
- parallel: true if the step can safely run concurrently with its neighbours
- Aim for 4–8 focused, concrete steps — no filler
- Do NOT include prompt, title, externalRef, or workItemId in the patch`
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
  <div class="h-full flex flex-col bg-background">
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
                @click="void router.push(lastSessionId ? `/sessions/${lastSessionId}` : '/sessions')"
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

            <!-- Running state, session interrupted — Resume -->
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

            <!-- Complete state: Open session (only when a session still exists) -->
            <button
              v-if="plan.status === 'complete' && lastSessionId"
              class="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
              @click="void router.push(`/sessions/${lastSessionId}`)"
            >
              <MonitorPlay :size="14" />
              Open session
            </button>

            <!-- Re-plan (all states except drafting mid-regen) -->
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
        <div class="rounded-lg border border-border">
          <div class="grid grid-cols-6 divide-x divide-border">
            <!-- STATUS -->
            <div class="px-4 py-3 rounded-l-lg">
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
                  plan.status === 'running' ? 'Running' : 'Complete'
                }}
              </span>
            </div>

            <!-- PLANNING MODEL -->
            <div class="px-4 py-3">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Planning Model</p>
              <div class="flex items-center gap-1.5">
                <span class="size-2 rounded-full shrink-0" :class="modelDotClass(singleModel ?? 'sonnet')" />
                <span class="text-xs font-mono">{{ singleModel ?? 'mixed' }}</span>
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
            <div class="px-4 py-3 rounded-r-lg">
              <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-2">Progress</p>
              <div v-if="plan.status === 'drafting'" class="text-sm text-muted-foreground italic">drafting…</div>
              <div v-else class="flex flex-col gap-1">
                <div class="w-full h-1.5 rounded-full bg-muted overflow-hidden min-w-[80px]">
                  <div
                    class="h-full rounded-full transition-all"
                    :class="plan.status === 'complete' ? 'bg-purple-500' : 'bg-green-500'"
                    :style="{ width: `${progressPercent}%` }"
                  />
                </div>
                <span class="text-sm font-semibold tabular-nums">{{ progressPercent }}%</span>
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
            <button
              class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="void addStep()"
            >
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
                <!-- Connector line (with gate marker when next step needs approval) -->
                <div
                  v-if="index < plan.steps.length - 1"
                  class="w-0.5 flex-1 min-h-[16px] relative"
                  :class="connectorClass(step)"
                >
                  <!-- Approval gate indicator on the line leading into a gated step -->
                  <div
                    v-if="plan.steps[index + 1]?.requiresApproval"
                    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 size-4 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center"
                    title="Approval gate — plan pauses here"
                  >
                    <Shield :size="8" class="text-amber-500" />
                  </div>
                </div>
              </div>

              <!-- Card -->
              <div
                class="flex-1 mb-2 rounded-lg border border-border bg-card overflow-hidden"
                :class="stepCardBorderClass(step)"
              >
                <!-- Card header (always visible, clickable to expand) -->
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

                  <!-- Running / skipped badges -->
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

                  <!-- Controls row -->
                  <div class="flex items-center gap-0.5 shrink-0" @click.stop>
                    <!-- Approval gate toggle -->
                    <button
                      class="size-6 flex items-center justify-center rounded transition-colors"
                      :class="step.requiresApproval
                        ? 'text-amber-500 hover:bg-amber-500/20'
                        : 'text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted/60'"
                      :title="step.requiresApproval ? 'Remove approval gate' : 'Add approval gate — plan pauses after this step'"
                      @click="toggleApproval(index).catch((e: unknown) => console.error('[PlannerDetailView] toggleApproval failed:', e))"
                    >
                      <Shield :size="12" />
                    </button>
                    <!-- Reorder up -->
                    <button
                      class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
                      :disabled="index === 0"
                      @click="void moveStep(index, -1)"
                    >
                      <ChevronUp :size="13" />
                    </button>
                    <!-- Reorder down -->
                    <button
                      class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
                      :disabled="index === (plan?.steps.length ?? 1) - 1"
                      @click="void moveStep(index, 1)"
                    >
                      <ChevronDown :size="13" />
                    </button>
                    <!-- Context menu -->
                    <DropdownMenu
                      :open="openStepDropdownIndex === index"
                      @update:open="(v: boolean) => { openStepDropdownIndex = v ? index : (null as null) }"
                    >
                      <DropdownMenuTrigger as-child>
                        <button
                          class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        >
                          <MoreHorizontal :size="13" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" class="w-48">
                        <DropdownMenuItem @click="toggleParallel(index).catch((e: unknown) => console.error('[PlannerDetailView] toggleParallel failed:', e))">
                          <GitBranch :size="13" class="text-muted-foreground shrink-0" />
                          {{ step.parallel ? 'Make sequential' : 'Mark as parallel' }}
                        </DropdownMenuItem>
                        <DropdownMenuItem @click="toggleApproval(index).catch((e: unknown) => console.error('[PlannerDetailView] toggleApproval failed:', e))">
                          <Shield :size="13" class="text-muted-foreground shrink-0" />
                          {{ step.requiresApproval ? 'Remove approval gate' : 'Add approval gate' }}
                        </DropdownMenuItem>
                        <DropdownMenuItem @click="openContextEditor(index)">
                          <MessageSquare :size="13" class="text-muted-foreground shrink-0" />
                          {{ step.context ? 'Edit context' : 'Attach context' }}
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <Zap :size="13" class="text-muted-foreground shrink-0" />
                          Change model
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <Play :size="13" class="text-muted-foreground shrink-0" />
                          Run only this step
                        </DropdownMenuItem>
                        <DropdownMenuItem @click="skipStep(index).catch((e: unknown) => console.error('[PlannerDetailView] skipStep failed:', e))">
                          <X :size="13" class="text-muted-foreground shrink-0" />
                          {{ step.status === 'skipped' ? 'Unskip step' : 'Skip step' }}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          class="text-destructive focus:text-destructive"
                          @click="removeStep(index).catch((e: unknown) => console.error('[PlannerDetailView] removeStep failed:', e))"
                        >
                          <X :size="13" class="shrink-0" />
                          Remove step
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                  <span
                    v-if="step.requiresApproval"
                    class="ml-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] flex items-center gap-1"
                  >
                    <Shield :size="9" />
                    gate
                  </span>
                  <span
                    v-if="step.context"
                    class="ml-0.5 text-amber-500/70"
                    title="Has attached context"
                  >
                    <MessageSquare :size="10" />
                  </span>
                </div>

                <!-- Expanded content -->
                <div v-if="expandedSteps.has(index)" class="border-t border-border px-4 py-3 space-y-3">
                  <!-- Editable title -->
                  <div>
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Title</p>
                    <input
                      v-if="editingStep?.index === index && editingStep.field === 'title'"
                      v-model="editingValue"
                      class="w-full text-sm bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                      @keydown.enter.prevent="void commitEdit()"
                      @keydown.escape.prevent="editingStep = null"
                      @blur="void commitEdit()"
                      @click.stop
                    />
                    <div
                      v-else
                      class="group flex items-center gap-1.5 text-sm font-semibold cursor-text hover:bg-muted/40 px-2 py-1 rounded -mx-2 transition-colors"
                      @click.stop="startEdit(index, 'title')"
                    >
                      <span class="flex-1">{{ step.title }}</span>
                      <Pencil :size="10" class="opacity-0 group-hover:opacity-50 text-muted-foreground shrink-0 transition-opacity" />
                    </div>
                  </div>

                  <!-- Summary (read-only) -->
                  <div v-if="step.summary">
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Summary</p>
                    <p class="text-sm">{{ step.summary }}</p>
                  </div>

                  <!-- Editable instructions -->
                  <div>
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1">Full Instructions</p>
                    <textarea
                      v-if="editingStep?.index === index && editingStep.field === 'instructions'"
                      v-model="editingValue"
                      rows="4"
                      class="w-full text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring resize-none"
                      @keydown.escape.prevent="editingStep = null"
                      @blur="void commitEdit()"
                      @click.stop
                    />
                    <div
                      v-else
                      class="group flex items-start gap-1.5 text-sm text-foreground/80 leading-relaxed cursor-text hover:bg-muted/40 px-2 py-1 rounded -mx-2 transition-colors"
                      @click.stop="startEdit(index, 'instructions')"
                    >
                      <span class="flex-1">{{ step.instructions ?? 'Click to add instructions…' }}</span>
                      <Pencil :size="10" class="opacity-0 group-hover:opacity-50 text-muted-foreground shrink-0 mt-0.5 transition-opacity" />
                    </div>
                  </div>

                  <!-- Context injection (shown when set or actively editing) -->
                  <div v-if="editingContext === index || step.context">
                    <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase mb-1 flex items-center gap-1.5">
                      <MessageSquare :size="10" class="text-amber-500" />
                      Additional Context
                    </p>
                    <textarea
                      v-if="editingContext === index"
                      v-model="contextValue"
                      rows="3"
                      placeholder="Notes for Claude when executing this step — e.g. existing patterns, gotchas, relevant files…"
                      class="w-full text-sm bg-background border border-amber-500/30 rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500/50 resize-none"
                      @keydown.escape.prevent="editingContext = null"
                      @blur="void saveContext(index)"
                      @click.stop
                    />
                    <div
                      v-else-if="step.context"
                      class="text-sm text-foreground/80 leading-relaxed cursor-text hover:bg-muted/40 px-2 py-1 rounded -mx-2 transition-colors"
                      @click.stop="openContextEditor(index)"
                    >
                      {{ step.context }}
                    </div>
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
                    <button
                      class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                      @click.stop="startEdit(index, 'instructions')"
                    >
                      <Pencil :size="11" />
                      Edit
                    </button>
                    <button class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors">
                      <RefreshCw :size="11" />
                      Re-plan
                    </button>
                    <button
                      class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                      @click.stop="toggleParallel(index).catch((e: unknown) => console.error('[PlannerDetailView] toggleParallel failed:', e))"
                    >
                      <GitBranch :size="11" />
                      {{ step.parallel ? 'Make sequential' : 'Mark as parallel' }}
                    </button>
                    <button
                      class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                      @click.stop="openContextEditor(index)"
                    >
                      <MessageSquare :size="11" />
                      {{ step.context ? 'Edit context' : 'Attach context' }}
                    </button>
                    <button
                      class="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
                      @click.stop="skipStep(index).catch((e: unknown) => console.error('[PlannerDetailView] skipStep failed:', e))"
                    >
                      <X :size="11" />
                      {{ step.status === 'skipped' ? 'Unskip' : 'Skip' }}
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
