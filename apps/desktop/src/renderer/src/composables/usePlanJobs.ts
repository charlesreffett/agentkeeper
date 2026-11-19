import { computed, onScopeDispose, type Ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import type { Plan, PlanJob, PlanStep, ProgressReport } from '@shared/ipc-contract'

/** A `working` report older than this renders as stale — agents are told to
 *  report at milestones, so silence this long usually means they stopped. */
export const PROGRESS_STALE_MS = 10 * 60 * 1000

export type JobDisplayState = 'working' | 'stale' | 'blocked' | 'done' | 'silent'

export function jobDisplayState(progress: ProgressReport | null, now = Date.now()): JobDisplayState {
  if (!progress) return 'silent'
  if (progress.state !== 'working') return progress.state
  return now - Date.parse(progress.createdAt) > PROGRESS_STALE_MS ? 'stale' : 'working'
}

export type ReviewDisplayState = 'approved' | 'outdated' | 'changes_requested' | 'none'

export function reviewDisplayState(job: PlanJob): ReviewDisplayState {
  const review = job.latestReview
  if (!review) return 'none'
  if (job.headSha && review.headSha !== job.headSha) return 'outdated'
  return review.verdict
}

export function buildJobPrompt(plan: Plan, step: PlanStep | null, instructions: string, branch: string): string {
  const assignment = [
    step ? `Step: ${step.title} (stepId: ${step.id})` : null,
    step?.instructions ? step.instructions : null,
    instructions.trim() || null,
  ].filter(Boolean).join('\n')
  return `You are one job on plan "${plan.title}" (${plan.planRef ?? plan.id}), plan id ${plan.id}.
You work in your own git worktree on branch ${branch}. Other jobs may be working on the same plan in parallel.

Start by calling get_plan to read the brief, the steps, and what the other jobs are doing.

Your assignment:
${assignment || 'Pick the next unassigned pending step from the plan.'}

Working rules:
- Call report_progress with state "working" when you start${step ? ` (stepId "${step.id}")` : ''} and at meaningful milestones, "blocked" if you need a human or another job, and "done" when finished.
- Commit your work on this branch.
- Before any git push, call review_push. Push only a HEAD it approved; any new commit needs a new review.`
}

export function usePlanJobs(projectPath: Ref<string | null>, planId: Ref<string>) {
  const queryClient = useQueryClient()
  const key = computed(() => queryKeys.plans.jobs(projectPath.value ?? '', planId.value))

  const { data, refetch } = useQuery({
    queryKey: key,
    queryFn: () => window.agentkeeper.plans.listJobs(projectPath.value!, planId.value),
    enabled: computed(() => !!projectPath.value && !!planId.value),
    // Staleness is time-based, so re-read periodically even with no events.
    refetchInterval: 60_000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: key.value })
  const offProgress = window.agentkeeper.progress.onUpdated((e) => {
    if (!e.planId || e.planId === planId.value) void invalidate()
  })
  const offPlan = window.agentkeeper.plans.onUpdated((e) => {
    if (e.id === planId.value) void invalidate()
  })
  onScopeDispose(() => {
    offProgress()
    offPlan()
  })

  async function createJobWorktree(plan: Plan, step: PlanStep | null) {
    const label = step?.title ?? 'job'
    return window.agentkeeper.worktrees.create(projectPath.value!, {
      baseRef: 'HEAD',
      branchRequest: `plan/${plan.planRef ?? plan.id.slice(0, 8)}-${label}`,
    })
  }

  async function linkJob(sessionLocalId: string, stepId: string | null) {
    await window.agentkeeper.plans.linkSession(projectPath.value!, planId.value, sessionLocalId, stepId)
    await invalidate()
  }

  return {
    jobs: computed<PlanJob[]>(() => data.value ?? []),
    refetch,
    createJobWorktree,
    linkJob,
  }
}

export function useSessionActivity(sessionLocalId: Ref<string | null>) {
  const queryClient = useQueryClient()
  const key = computed(() => queryKeys.progress.session(sessionLocalId.value ?? ''))
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => window.agentkeeper.progress.forSession(sessionLocalId.value!),
    enabled: computed(() => !!sessionLocalId.value),
    refetchInterval: 60_000,
  })
  const off = window.agentkeeper.progress.onUpdated((e) => {
    if (e.sessionLocalId === sessionLocalId.value) void queryClient.invalidateQueries({ queryKey: key.value })
  })
  onScopeDispose(off)
  return {
    activity: computed(() => data.value ?? null),
  }
}
