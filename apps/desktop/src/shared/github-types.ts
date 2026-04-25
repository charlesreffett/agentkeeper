// Shared GitHub types — imported by renderer, preload, and main. Pure types only.

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

export interface GitHubConfig {
  repos: string[]
}
