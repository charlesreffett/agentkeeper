import { describe, expect, it } from 'vitest'
import type { PlanJob, ProgressReport, PushReview } from '@shared/ipc-contract'
import { PROGRESS_STALE_MS, jobDisplayState, reviewDisplayState } from './usePlanJobs'

const NOW = Date.parse('2026-11-19T12:00:00Z')

const report = (state: ProgressReport['state'], ageMs: number): ProgressReport => ({
  id: 1, planId: 'p', sessionLocalId: 's', agentLocalId: 's', stepId: null, state, note: 'n',
  createdAt: new Date(NOW - ageMs).toISOString(),
})

const review = (headSha: string, verdict: PushReview['verdict']): PushReview => ({
  id: 'r', sessionLocalId: 's', agentLocalId: 's', planId: 'p', branch: 'b', baseSha: 'base',
  headSha, verdict, summary: '', findings: [], createdAt: new Date(NOW).toISOString(),
})

const job = (headSha: string | null, latestReview: PushReview | null): PlanJob => ({
  sessionLocalId: 's', stepId: null, addedAt: new Date(NOW).toISOString(), headSha,
  latestProgress: null, latestReview,
})

describe('job display state', () => {
  it('marks a job with no reports as silent', () => {
    expect(jobDisplayState(null, NOW)).toBe('silent')
  })

  it('expires working reports into stale', () => {
    expect(jobDisplayState(report('working', PROGRESS_STALE_MS - 1), NOW)).toBe('working')
    expect(jobDisplayState(report('working', PROGRESS_STALE_MS + 1), NOW)).toBe('stale')
  })

  it('never expires blocked or done', () => {
    expect(jobDisplayState(report('blocked', PROGRESS_STALE_MS * 10), NOW)).toBe('blocked')
    expect(jobDisplayState(report('done', PROGRESS_STALE_MS * 10), NOW)).toBe('done')
  })
})

describe('review display state', () => {
  it('reports approval only for the reviewed HEAD', () => {
    expect(reviewDisplayState(job('abc', review('abc', 'approved')))).toBe('approved')
    expect(reviewDisplayState(job('def', review('abc', 'approved')))).toBe('outdated')
  })

  it('keeps the verdict when HEAD is unreadable', () => {
    expect(reviewDisplayState(job(null, review('abc', 'changes_requested')))).toBe('changes_requested')
  })

  it('reports none without a review', () => {
    expect(reviewDisplayState(job('abc', null))).toBe('none')
  })
})
