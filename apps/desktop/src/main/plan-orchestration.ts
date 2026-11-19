import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { BrowserWindow } from 'electron'
import { asc, desc, eq } from 'drizzle-orm'
import { getDb } from './db/index'
import {
  planSessions as planSessionsTable,
  progressReports as progressTable,
  pushReviews as pushReviewsTable,
} from './db/schema'
import * as registry from './session-registry'
import { getPlan, planIdForSession, updatePlan } from './plans'
import { getHarness } from './harness/index'
import { getDefaultModel } from './models'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { parseReviewResponse } from './push-review-policy'
import type {
  PlanJob,
  ProgressReport,
  ProgressState,
  PushReview,
  PushReviewFinding,
  PushReviewVerdict,
  SessionActivity,
} from '../shared/ipc-contract'

const exec = promisify(execFile)

const MAX_REVIEW_DIFF_CHARS = 60_000

export interface McpCaller {
  agentLocalId: string
  sessionLocalId: string
  cwd: string | null
  projectPath: string | null
  harnessId: string | undefined
  model: string | null
}

// MCP servers are bound to an agent id; solo sessions share the id with their
// session, agency members don't — the agents row is the bridge.
export function resolveCaller(callerId: string): McpCaller {
  const agent = registry.getAgent(callerId)
  const sessionLocalId = agent?.sessionLocalId ?? callerId
  const session = registry.getSession(sessionLocalId)
  return {
    agentLocalId: callerId,
    sessionLocalId,
    cwd: session?.worktreePath ?? session?.projectPath ?? null,
    projectPath: session?.projectPath ?? null,
    harnessId: session?.harnessId,
    model: session?.model ?? null,
  }
}

function rowToProgress(row: typeof progressTable.$inferSelect): ProgressReport {
  return {
    id: row.id,
    planId: row.planId ?? null,
    sessionLocalId: row.sessionLocalId,
    agentLocalId: row.agentLocalId,
    stepId: row.stepId ?? null,
    state: row.state as ProgressState,
    note: row.note,
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

function rowToReview(row: typeof pushReviewsTable.$inferSelect): PushReview {
  return {
    id: row.id,
    sessionLocalId: row.sessionLocalId,
    agentLocalId: row.agentLocalId,
    planId: row.planId ?? null,
    branch: row.branch ?? null,
    baseSha: row.baseSha,
    headSha: row.headSha,
    verdict: row.verdict as PushReviewVerdict,
    summary: row.summary,
    findings: JSON.parse(row.findings) as PushReviewFinding[],
    createdAt: new Date(row.createdAt).toISOString(),
  }
}

function broadcastProgress(sessionLocalId: string, planId: string | null): void {
  BrowserWindow.getAllWindows().forEach((win) =>
    win.webContents.send(IPC_CHANNELS.progressUpdated, { sessionLocalId, planId }),
  )
}

const stepStatusFor: Record<ProgressState, 'running' | 'complete' | null> = {
  working: 'running',
  done: 'complete',
  blocked: null,
}

export async function recordProgress(
  caller: McpCaller,
  input: { state: ProgressState; note: string; stepId?: string },
): Promise<ProgressReport> {
  const planId = planIdForSession(caller.sessionLocalId)
  const now = Date.now()
  const inserted = getDb()
    .insert(progressTable)
    .values({
      planId,
      sessionLocalId: caller.sessionLocalId,
      agentLocalId: caller.agentLocalId,
      stepId: input.stepId ?? null,
      state: input.state,
      note: input.note,
      createdAt: now,
    })
    .returning()
    .get()

  const stepStatus = stepStatusFor[input.state]
  if (planId && input.stepId && stepStatus && caller.projectPath) {
    const current = (await getPlan(caller.projectPath, planId))?.steps.find((s) => s.id === input.stepId)
    // Milestone reports repeat "working"; only the first transition stamps the start.
    if (current && current.status !== stepStatus) {
      await updatePlan(caller.projectPath, planId, {
        stepId: input.stepId,
        stepPatch: {
          status: stepStatus,
          ...(stepStatus === 'running' ? { startedAt: now } : { completedAt: now }),
        },
      })
    }
  }
  broadcastProgress(caller.sessionLocalId, planId)
  return rowToProgress(inserted)
}

function latestProgress(sessionLocalId: string): ProgressReport | null {
  const row = getDb().select().from(progressTable)
    .where(eq(progressTable.sessionLocalId, sessionLocalId))
    .orderBy(desc(progressTable.createdAt), desc(progressTable.id))
    .limit(1).get()
  return row ? rowToProgress(row) : null
}

function latestReview(sessionLocalId: string): PushReview | null {
  const row = getDb().select().from(pushReviewsTable)
    .where(eq(pushReviewsTable.sessionLocalId, sessionLocalId))
    .orderBy(desc(pushReviewsTable.createdAt))
    .limit(1).get()
  return row ? rowToReview(row) : null
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], { maxBuffer: 32 * 1024 * 1024 })
  return stdout.trim()
}

async function headOf(cwd: string | null): Promise<string | null> {
  if (!cwd) return null
  try {
    return await git(cwd, ['rev-parse', 'HEAD'])
  } catch {
    return null
  }
}

export async function listPlanJobs(projectPath: string, planId: string): Promise<PlanJob[]> {
  const plan = await getPlan(projectPath, planId)
  if (!plan) return []
  const links = getDb().select().from(planSessionsTable)
    .where(eq(planSessionsTable.planId, planId))
    .orderBy(asc(planSessionsTable.addedAt))
    .all()
  return Promise.all(links.map(async (link) => {
    const session = registry.getSession(link.sessionLocalId)
    return {
      sessionLocalId: link.sessionLocalId,
      stepId: link.stepId ?? null,
      addedAt: new Date(link.addedAt).toISOString(),
      headSha: await headOf(session?.worktreePath ?? session?.projectPath ?? null),
      latestProgress: latestProgress(link.sessionLocalId),
      latestReview: latestReview(link.sessionLocalId),
    }
  }))
}

export function sessionActivity(sessionLocalId: string): SessionActivity {
  const db = getDb()
  return {
    planId: planIdForSession(sessionLocalId),
    progress: db.select().from(progressTable)
      .where(eq(progressTable.sessionLocalId, sessionLocalId))
      .orderBy(desc(progressTable.createdAt), desc(progressTable.id))
      .limit(50).all().map(rowToProgress),
    reviews: db.select().from(pushReviewsTable)
      .where(eq(pushReviewsTable.sessionLocalId, sessionLocalId))
      .orderBy(desc(pushReviewsTable.createdAt))
      .limit(20).all().map(rowToReview),
  }
}

export async function describePlanForAgent(caller: McpCaller, requestedPlanId?: string): Promise<string> {
  const planId = requestedPlanId ?? planIdForSession(caller.sessionLocalId)
  if (!planId) return 'No plan is linked to this session.'
  if (!caller.projectPath) return 'This session has no project, so it has no plans.'
  const plan = await getPlan(caller.projectPath, planId)
  if (!plan) return `Plan "${planId}" was not found in this project.`
  const jobs = await listPlanJobs(caller.projectPath, planId)
  const link = jobs.find((j) => j.sessionLocalId === caller.sessionLocalId)

  const lines = [
    `# ${plan.title} (${plan.planRef ?? plan.id})`,
    `Plan id: ${plan.id}  ·  status: ${plan.status}`,
    '',
    '## Brief',
    plan.brief?.trim() || '(no brief written yet)',
    '',
    '## Steps',
    ...plan.steps.map((s, i) => {
      const mine = link?.stepId === s.id ? '  ← assigned to you' : ''
      return `${i + 1}. [${s.status}] ${s.title} (stepId: ${s.id})${mine}${s.instructions ? `\n   ${s.instructions}` : ''}`
    }),
    '',
    '## Jobs',
    ...jobs.map((j) => {
      const who = registry.getSession(j.sessionLocalId)
      const label = who?.title ?? j.sessionLocalId
      const you = j.sessionLocalId === caller.sessionLocalId ? ' (you)' : ''
      const progress = j.latestProgress
        ? `${j.latestProgress.state}: ${j.latestProgress.note}`
        : 'no progress reported'
      return `- ${label}${you} [${who?.branch ?? 'no branch'}] — ${progress}`
    }),
  ]
  return lines.join('\n')
}

// ─── Pre-push review ─────────────────────────────────────────────────────────

async function resolveBase(cwd: string): Promise<{ ref: string; sha: string }> {
  const candidates: string[] = []
  try {
    candidates.push(await git(cwd, ['rev-parse', '--abbrev-ref', 'origin/HEAD']))
  } catch { /* no origin/HEAD symref */ }
  candidates.push('origin/main', 'origin/master', 'main', 'master')
  for (const ref of candidates) {
    try {
      const sha = await git(cwd, ['merge-base', 'HEAD', ref])
      return { ref, sha }
    } catch { /* try next */ }
  }
  throw new Error('Could not find a base branch (tried origin/HEAD, origin/main, origin/master, main, master).')
}

function buildReviewPrompt(input: {
  planTitle: string | null
  brief: string | null
  baseRef: string
  stat: string
  log: string
  diff: string
  truncated: boolean
}): string {
  return [
    'You are a strict code reviewer gating a git push. Review ONLY the diff below.',
    'Do not use any tools. Do not modify anything. Respond with a single JSON object and nothing else:',
    '{"verdict":"approved"|"changes_requested","summary":"<one or two sentences>","findings":[{"severity":"blocker"|"major"|"minor","file":"<path>","line":<number>,"message":"<problem and fix>"}]}',
    'Request changes only for blocker or major findings: correctness bugs, security problems, data loss, broken builds, or work that clearly contradicts the task brief. Minor findings never block.',
    '',
    input.planTitle ? `Task: ${input.planTitle}` : 'Task: (no linked plan)',
    input.brief ? `Brief:\n${input.brief}` : '',
    '',
    `Commits since ${input.baseRef}:`,
    input.log || '(none)',
    '',
    'Diff stat:',
    input.stat,
    '',
    input.truncated ? `Diff (truncated to ${MAX_REVIEW_DIFF_CHARS} characters; judge only what is shown):` : 'Diff:',
    input.diff,
  ].join('\n')
}

export async function reviewPush(caller: McpCaller): Promise<PushReview> {
  const cwd = caller.cwd
  if (!cwd) throw new Error('This session has no working directory to review.')
  const dirty = await git(cwd, ['status', '--porcelain', '--untracked-files=no'])
  if (dirty) throw new Error('Uncommitted changes to tracked files. Commit first — a review receipt covers one exact commit.')

  const headSha = await git(cwd, ['rev-parse', 'HEAD'])
  const base = await resolveBase(cwd)
  if (base.sha === headSha) throw new Error(`No commits ahead of ${base.ref}; nothing to review.`)

  const [stat, log, fullDiff] = await Promise.all([
    git(cwd, ['diff', '--stat', `${base.sha}..${headSha}`]),
    git(cwd, ['log', '--oneline', `${base.sha}..${headSha}`]),
    git(cwd, ['diff', `${base.sha}..${headSha}`]),
  ])
  const truncated = fullDiff.length > MAX_REVIEW_DIFF_CHARS
  const planId = planIdForSession(caller.sessionLocalId)
  const plan = planId && caller.projectPath ? await getPlan(caller.projectPath, planId) : null

  const prompt = buildReviewPrompt({
    planTitle: plan?.title ?? null,
    brief: plan?.brief ?? null,
    baseRef: base.ref,
    stat,
    log,
    diff: truncated ? fullDiff.slice(0, MAX_REVIEW_DIFF_CHARS) : fullDiff,
    truncated,
  })

  // An empty scratch cwd keeps a harness that ignores disallowedTools away
  // from the checkout under review.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'agentkeeper-review-'))
  let text: string
  try {
    const harness = getHarness(caller.harnessId)
    text = await harness.runPrompt(prompt, {
      cwd: scratch,
      model: caller.model ?? await getDefaultModel(caller.harnessId),
      disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Agent', 'WebFetch', 'WebSearch'],
    })
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
  const parsed = parseReviewResponse(text)

  // HEAD may have moved while the reviewer ran; a receipt must name what was reviewed.
  const headAfter = await headOf(cwd)
  if (headAfter !== headSha) throw new Error('HEAD changed during review; run review_push again.')

  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => null)
  const id = randomUUID()
  const row = getDb().insert(pushReviewsTable).values({
    id,
    sessionLocalId: caller.sessionLocalId,
    agentLocalId: caller.agentLocalId,
    planId,
    branch,
    baseSha: base.sha,
    headSha,
    verdict: parsed.verdict,
    summary: parsed.summary,
    findings: JSON.stringify(parsed.findings),
    createdAt: Date.now(),
  }).returning().get()
  broadcastProgress(caller.sessionLocalId, planId)
  return rowToReview(row)
}

export function formatReview(review: PushReview): string {
  const head = review.verdict === 'approved'
    ? `APPROVED ${review.headSha} (receipt ${review.id}). You may push this exact commit.`
    : `CHANGES REQUESTED for ${review.headSha}. Fix the findings, commit, and call review_push again before pushing.`
  const findings = review.findings.map((f) => {
    const loc = f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''
    return `- [${f.severity}]${loc} ${f.message}`
  })
  return [head, review.summary, ...findings].filter(Boolean).join('\n')
}
