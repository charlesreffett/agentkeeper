<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useNow } from '@vueuse/core'
import { StatusDot } from '@/components/ui/status-dot'
import { GitBranch, Plus, Loader2, ShieldCheck, TriangleAlert } from '@/components/icons/app-icons'
import { useSessionStore } from '@/stores/sessions'
import {
  buildJobPrompt,
  jobDisplayState,
  reviewDisplayState,
  usePlanJobs,
  type JobDisplayState,
  type ReviewDisplayState,
} from '@/composables/usePlanJobs'
import type { Plan, PlanJob } from '@shared/ipc-contract'

const props = defineProps<{ plan: Plan; projectPath: string }>()

const router = useRouter()
const sessionStore = useSessionStore()
const now = useNow({ interval: 30_000 })
const { jobs, createJobWorktree, linkJob } = usePlanJobs(
  computed(() => props.projectPath),
  computed(() => props.plan.id),
)

const showForm = ref(false)
const stepId = ref('')
const instructions = ref('')
const launching = ref(false)
const launchError = ref<string | null>(null)

const openSteps = computed(() =>
  props.plan.steps.filter((s) => s.status !== 'complete' && s.status !== 'skipped'),
)

const stateLabel: Record<JobDisplayState, string> = {
  working: 'Working',
  stale: 'Stale',
  blocked: 'Blocked',
  done: 'Done',
  silent: 'No report',
}
const stateDot: Record<JobDisplayState, 'running' | 'suspended' | 'blocked' | 'idle' | 'error'> = {
  working: 'running',
  stale: 'suspended',
  blocked: 'error',
  done: 'idle',
  silent: 'idle',
}
const reviewLabel: Record<ReviewDisplayState, string> = {
  approved: 'Push approved',
  outdated: 'Review outdated',
  changes_requested: 'Changes requested',
  none: 'Not reviewed',
}

function sessionLabel(job: PlanJob): { title: string; branch: string | null } {
  const s = sessionStore.getSession(job.sessionLocalId)
  return {
    title: s?.title ?? s?.initialPrompt?.slice(0, 60) ?? job.sessionLocalId.slice(0, 8),
    branch: s?.branch ?? null,
  }
}

function stepTitle(id: string | null): string | null {
  if (!id) return null
  return props.plan.steps.find((s) => s.id === id)?.title ?? null
}

async function launch() {
  launching.value = true
  launchError.value = null
  try {
    const step = props.plan.steps.find((s) => s.id === stepId.value) ?? null
    const wt = await createJobWorktree(props.plan, step)
    const localId = await sessionStore.start({
      projectPath: props.projectPath,
      worktreePath: wt.path,
      branch: wt.branch,
      initialPrompt: buildJobPrompt(props.plan, step, instructions.value, wt.branch),
      workItem: props.plan.workItem ?? null,
    })
    await linkJob(localId, step?.id ?? null)
    showForm.value = false
    stepId.value = ''
    instructions.value = ''
    void router.push(`/sessions/${localId}`)
  } catch (err) {
    launchError.value = err instanceof Error ? err.message : String(err)
  } finally {
    launching.value = false
  }
}
</script>

<template>
  <div class="rounded-lg border border-border px-4 py-3">
    <div class="flex items-center justify-between mb-2">
      <p class="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        Jobs · {{ jobs.length }}
      </p>
      <button
        v-if="!showForm"
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        @click="showForm = true"
      >
        <Plus :size="12" /> New job
      </button>
    </div>

    <div v-if="showForm" class="mb-3 space-y-2 rounded-md bg-muted/30 p-3">
      <select
        v-model="stepId"
        class="w-full bg-background border border-border rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">No specific step</option>
        <option v-for="s in openSteps" :key="s.id" :value="s.id">{{ s.title }}</option>
      </select>
      <textarea
        v-model="instructions"
        rows="3"
        placeholder="Extra instructions (optional)"
        class="w-full text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring resize-y"
      />
      <p class="text-xs text-muted-foreground">Starts a solo session in a new worktree from the project's current HEAD.</p>
      <p v-if="launchError" class="text-xs text-destructive">{{ launchError }}</p>
      <div class="flex justify-end gap-2">
        <button
          class="px-3 py-1 text-xs rounded-md border border-border hover:bg-muted/60"
          :disabled="launching"
          @click="showForm = false"
        >
          Cancel
        </button>
        <button
          class="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium disabled:opacity-50"
          :disabled="launching"
          @click="void launch()"
        >
          <Loader2 v-if="launching" :size="12" class="animate-spin" />
          Launch
        </button>
      </div>
    </div>

    <p v-if="jobs.length === 0 && !showForm" class="text-sm text-muted-foreground/60">
      No jobs yet. Each job runs in its own worktree and reports progress here.
    </p>

    <ul class="divide-y divide-border">
      <li
        v-for="job in jobs"
        :key="job.sessionLocalId"
        class="py-2 flex items-start gap-3 cursor-pointer hover:bg-muted/40 -mx-2 px-2 rounded"
        @click="router.push(`/sessions/${job.sessionLocalId}`)"
      >
        <StatusDot :variant="stateDot[jobDisplayState(job.latestProgress, now.getTime())]" class="mt-1.5" />
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 text-sm">
            <span class="truncate font-medium">{{ sessionLabel(job).title }}</span>
            <span v-if="sessionLabel(job).branch" class="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
              <GitBranch :size="10" />{{ sessionLabel(job).branch }}
            </span>
          </div>
          <p v-if="stepTitle(job.stepId)" class="text-xs text-muted-foreground truncate">Step: {{ stepTitle(job.stepId) }}</p>
          <p class="text-xs text-foreground/80 truncate">
            <span class="font-medium">{{ stateLabel[jobDisplayState(job.latestProgress, now.getTime())] }}</span>
            <template v-if="job.latestProgress"> — {{ job.latestProgress.note }}</template>
          </p>
        </div>
        <span
          class="flex items-center gap-1 text-xs shrink-0"
          :class="{
            'text-emerald-600 dark:text-emerald-400': reviewDisplayState(job) === 'approved',
            'text-destructive': reviewDisplayState(job) === 'changes_requested',
            'text-amber-600 dark:text-amber-400': reviewDisplayState(job) === 'outdated',
            'text-muted-foreground': reviewDisplayState(job) === 'none',
          }"
          :title="job.latestReview?.summary"
        >
          <ShieldCheck v-if="reviewDisplayState(job) === 'approved'" :size="12" />
          <TriangleAlert v-else-if="reviewDisplayState(job) !== 'none'" :size="12" />
          {{ reviewLabel[reviewDisplayState(job)] }}
        </span>
      </li>
    </ul>
  </div>
</template>
