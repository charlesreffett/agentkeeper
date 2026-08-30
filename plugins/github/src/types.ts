// Raw shapes returned by the gh CLI / GitHub REST API (before normalization).

export type PRState = 'open' | 'closed' | 'merged'
export type ReviewDecision =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_REQUIRED'
  | 'COMMENTED'
  | null
export type MergeMethod = 'squash' | 'merge' | 'rebase'
export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
export type CheckState = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'

// ─── Raw gh CLI shapes ───────────────────────────────────────────────────────

export interface RawGHAuthor {
  login: string
}

export interface RawGHLabel {
  name: string
}

// Item in gh pr view/list --json statusCheckRollup
export interface RawCheckItem {
  __typename?: string   // 'CheckRun' | 'StatusContext'
  // CheckRun fields
  name?: string
  status?: string       // QUEUED | IN_PROGRESS | COMPLETED | WAITING | ...
  conclusion?: string   // SUCCESS | FAILURE | NEUTRAL | CANCELLED | SKIPPED | TIMED_OUT | ACTION_REQUIRED
  detailsUrl?: string
  // StatusContext fields
  context?: string
  state?: string        // SUCCESS | FAILURE | PENDING | ERROR | EXPECTED
  targetUrl?: string
}

export interface RawGHPR {
  number: number
  title: string
  state: string
  isDraft: boolean
  author: RawGHAuthor
  headRefName: string
  baseRefName: string
  reviewDecision: string | null
  statusCheckRollup: RawCheckItem[] | null
  updatedAt: string
  url: string
  labels: RawGHLabel[]
  body?: string
  additions?: number
  deletions?: number
  changedFiles?: number
  mergeable?: string
  reviews?: RawGHReview[]
}

export interface RawGHReview {
  id: number
  author: RawGHAuthor
  state: string
  body: string
  submittedAt: string
}

// GitHub REST API comment shape (both issue-level and review thread)
export interface RawAPIComment {
  id: number
  user: { login: string }
  body: string
  created_at: string
  path?: string
  line?: number
  original_line?: number
}

export interface GHIssue {
  number: number
  title: string
  body: string
  state: string          // 'OPEN' | 'CLOSED'
  author: RawGHAuthor
  assignees: RawGHAuthor[]
  labels: RawGHLabel[]
  url: string
  createdAt: string
  updatedAt: string
}

// ─── Normalized shapes (match the shared IPC types in github-types.ts) ───────

export interface PRSummary {
  number: number
  title: string
  state: PRState
  isDraft: boolean
  author: string
  headRef: string
  baseRef: string
  reviewDecision: ReviewDecision
  checksState: CheckState | null
  updatedAt: string
  url: string
  labels: string[]
  repo: string
}

export interface PRComment {
  id: number
  author: string
  body: string
  createdAt: string
  path?: string
  line?: number
}

export interface PRReview {
  id: number
  author: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'
  body: string
  submittedAt: string
}

export interface PRDetail extends PRSummary {
  body: string
  additions: number
  deletions: number
  changedFiles: number
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  comments: PRComment[]
  reviews: PRReview[]
}

export interface CheckRun {
  name: string
  state: CheckState
  conclusion: string | null
  link: string
}

export interface PRFilters {
  state?: PRState | 'all'
  author?: string
  assignee?: string
  label?: string
  search?: string
  checksState?: CheckState
  repo?: string
}

export interface CreatePRParams {
  repo: string
  title: string
  body: string
  head: string
  base: string
  draft?: boolean
}
