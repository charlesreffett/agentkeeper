import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  CheckRun,
  CheckState,
  CreatePRParams,
  GHIssue,
  MergeMethod,
  PRComment,
  PRDetail,
  PRFilters,
  PRReview,
  PRSummary,
  RawAPIComment,
  RawCheckItem,
  RawGHPR,
  RawGHReview,
  ReviewDecision,
  ReviewEvent,
} from './types.js'

const execFileAsync = (file: string, args: string[]) =>
  promisify(execFile)(file, args, { timeout: 10_000 })

export async function checkCliPresent(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['--version'])
    return true
  } catch {
    return false
  }
}

function splitRepo(repo: string): { owner: string; repoName: string } {
  const slash = repo.indexOf('/')
  if (slash === -1) return { owner: repo, repoName: repo }
  return { owner: repo.slice(0, slash), repoName: repo.slice(slash + 1) }
}

// ─── State normalization ─────────────────────────────────────────────────────

function mapPRState(ghState: string): 'open' | 'closed' | 'merged' {
  switch (ghState.toUpperCase()) {
    case 'OPEN': return 'open'
    case 'CLOSED': return 'closed'
    case 'MERGED': return 'merged'
    default: return 'open'
  }
}

function mapReviewDecision(rd: string | null | undefined): ReviewDecision {
  if (!rd) return null
  if (
    rd === 'APPROVED' ||
    rd === 'CHANGES_REQUESTED' ||
    rd === 'REVIEW_REQUIRED' ||
    rd === 'COMMENTED'
  )
    return rd
  return null
}

function mapSingleCheckState(check: RawCheckItem): CheckState {
  if (check.__typename === 'CheckRun' || 'conclusion' in check) {
    const status = check.status?.toUpperCase()
    if (status !== 'COMPLETED' && status !== undefined) return 'pending'
    switch (check.conclusion?.toUpperCase()) {
      case 'SUCCESS':
      case 'NEUTRAL':
        return 'pass'
      case 'FAILURE':
      case 'TIMED_OUT':
      case 'ACTION_REQUIRED':
        return 'fail'
      case 'CANCELLED':
        return 'cancel'
      case 'SKIPPED':
        return 'skipping'
      default:
        return 'pass'
    }
  }
  // StatusContext
  switch (check.state?.toUpperCase()) {
    case 'SUCCESS':
      return 'pass'
    case 'FAILURE':
    case 'ERROR':
      return 'fail'
    default:
      return 'pending'
  }
}

function aggregateChecksState(rollup: RawCheckItem[] | null | undefined): CheckState | null {
  if (!rollup || rollup.length === 0) return null
  const states = rollup.map(mapSingleCheckState)
  if (states.some((s) => s === 'fail')) return 'fail'
  if (states.some((s) => s === 'pending')) return 'pending'
  if (states.some((s) => s === 'cancel')) return 'cancel'
  if (states.every((s) => s === 'skipping')) return 'skipping'
  return 'pass'
}

function mapCheckItem(check: RawCheckItem): CheckRun {
  const name = check.name ?? check.context ?? 'unknown'
  const link = check.detailsUrl ?? check.targetUrl ?? ''
  const state = mapSingleCheckState(check)
  const conclusion = check.conclusion ?? check.state ?? null
  return { name, state, conclusion, link }
}

function mapToPRSummary(raw: RawGHPR, repo: string): PRSummary {
  return {
    number: raw.number,
    title: raw.title,
    state: mapPRState(raw.state),
    isDraft: raw.isDraft,
    author: raw.author?.login ?? '',
    headRef: raw.headRefName,
    baseRef: raw.baseRefName,
    reviewDecision: mapReviewDecision(raw.reviewDecision),
    checksState: aggregateChecksState(raw.statusCheckRollup),
    updatedAt: raw.updatedAt,
    url: raw.url,
    labels: (raw.labels ?? []).map((l) => l.name),
    repo,
  }
}

function mapReview(r: RawGHReview): PRReview {
  const validStates = ['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING'] as const
  type ReviewState = (typeof validStates)[number]
  const state: ReviewState = validStates.includes(r.state as ReviewState)
    ? (r.state as ReviewState)
    : 'COMMENTED'
  return { id: r.id, author: r.author?.login ?? '', state, body: r.body, submittedAt: r.submittedAt }
}

function mapAPIComment(c: RawAPIComment, opts?: { path?: string; line?: number }): PRComment {
  const comment: PRComment = {
    id: c.id,
    author: c.user?.login ?? '',
    body: c.body,
    createdAt: c.created_at,
  }
  const path = opts?.path ?? c.path
  const line = opts?.line ?? c.line ?? c.original_line
  if (path) comment.path = path
  if (line != null) comment.line = line
  return comment
}

// ─── PR JSON fields ──────────────────────────────────────────────────────────

const PR_SUMMARY_FIELDS =
  'number,title,state,isDraft,author,headRefName,baseRefName,reviewDecision,statusCheckRollup,updatedAt,url,labels'

const PR_DETAIL_FIELDS =
  `${PR_SUMMARY_FIELDS},body,additions,deletions,changedFiles,mergeable,reviews`

// ─── Issues ──────────────────────────────────────────────────────────────────

export async function listIssues(
  repo: string,
  state: 'open' | 'closed' | 'all' = 'open',
): Promise<GHIssue[]> {
  const args = [
    'issue', 'list',
    '--repo', repo,
    '--state', state,
    '--json', 'number,title,body,state,author,assignees,labels,url,createdAt,updatedAt',
    '--limit', '200',
  ]
  const { stdout } = await execFileAsync('gh', args)
  return JSON.parse(stdout.trim()) as GHIssue[]
}

export async function getIssue(repo: string, number: number): Promise<GHIssue> {
  const { stdout } = await execFileAsync('gh', [
    'issue', 'view', String(number),
    '--repo', repo,
    '--json', 'number,title,body,state,author,assignees,labels,url,createdAt,updatedAt',
  ])
  return JSON.parse(stdout.trim()) as GHIssue
}

export async function closeIssue(repo: string, number: number): Promise<void> {
  await execFileAsync('gh', ['issue', 'close', String(number), '--repo', repo])
}

export async function reopenIssue(repo: string, number: number): Promise<void> {
  await execFileAsync('gh', ['issue', 'reopen', String(number), '--repo', repo])
}

// ─── PRs — list + detail ─────────────────────────────────────────────────────

export async function listPRs(repo: string, filters: PRFilters): Promise<PRSummary[]> {
  const args = ['pr', 'list', '--repo', repo, '--json', PR_SUMMARY_FIELDS, '--limit', '100']

  const state = filters.state ?? 'open'
  args.push('--state', state)

  if (filters.author) args.push('--author', filters.author)
  if (filters.assignee) args.push('--assignee', filters.assignee)
  if (filters.label) args.push('--label', filters.label)
  if (filters.search) args.push('--search', filters.search)

  const { stdout } = await execFileAsync('gh', args)
  let results = (JSON.parse(stdout.trim()) as RawGHPR[]).map((r) => mapToPRSummary(r, repo))

  if (filters.checksState) {
    results = results.filter((pr) => pr.checksState === filters.checksState)
  }

  return results
}

export async function getPR(repo: string, number: number): Promise<PRDetail> {
  const [prOut, issueComments, reviewComments] = await Promise.all([
    execFileAsync('gh', [
      'pr', 'view', String(number),
      '--repo', repo,
      '--json', PR_DETAIL_FIELDS,
    ]),
    fetchAPIComments(repo, number, 'issues'),
    fetchAPIComments(repo, number, 'pulls'),
  ])

  const raw = JSON.parse(prOut.stdout.trim()) as RawGHPR

  const allComments: PRComment[] = [
    ...issueComments.map((c) => mapAPIComment(c)),
    ...reviewComments.map((c) => mapAPIComment(c)),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const validMergeable = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'] as const
  type Mergeable = (typeof validMergeable)[number]
  const mergeable: Mergeable =
    raw.mergeable && validMergeable.includes(raw.mergeable as Mergeable)
      ? (raw.mergeable as Mergeable)
      : 'UNKNOWN'

  return {
    ...mapToPRSummary(raw, repo),
    body: raw.body ?? '',
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    mergeable,
    comments: allComments,
    reviews: (raw.reviews ?? []).map(mapReview),
  }
}

async function fetchAPIComments(
  repo: string,
  number: number,
  kind: 'issues' | 'pulls',
): Promise<RawAPIComment[]> {
  const { owner, repoName } = splitRepo(repo)
  const endpoint = `repos/${owner}/${repoName}/${kind}/${number}/comments?per_page=100`
  try {
    const { stdout } = await execFileAsync('gh', ['api', endpoint])
    return JSON.parse(stdout.trim()) as RawAPIComment[]
  } catch {
    return []
  }
}

// ─── PR content ───────────────────────────────────────────────────────────────

export async function getPRDiff(repo: string, number: number): Promise<string> {
  const { stdout } = await execFileAsync('gh', [
    'pr', 'diff', String(number), '--repo', repo,
  ])
  return stdout
}

export async function getPRChecks(repo: string, number: number): Promise<CheckRun[]> {
  const { stdout } = await execFileAsync('gh', [
    'pr', 'view', String(number),
    '--repo', repo,
    '--json', 'statusCheckRollup',
  ])
  const { statusCheckRollup } = JSON.parse(stdout.trim()) as { statusCheckRollup: RawCheckItem[] }
  return (statusCheckRollup ?? []).map(mapCheckItem)
}

export async function getPRComments(repo: string, number: number): Promise<PRComment[]> {
  const [issueComments, reviewComments] = await Promise.all([
    fetchAPIComments(repo, number, 'issues'),
    fetchAPIComments(repo, number, 'pulls'),
  ])
  return [
    ...issueComments.map((c) => mapAPIComment(c)),
    ...reviewComments.map((c) => mapAPIComment(c)),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

// ─── PR actions ───────────────────────────────────────────────────────────────

export async function addComment(repo: string, number: number, body: string): Promise<void> {
  await execFileAsync('gh', ['pr', 'comment', String(number), '--repo', repo, '--body', body])
}

export async function submitReview(
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
): Promise<void> {
  const flag =
    event === 'APPROVE'
      ? '--approve'
      : event === 'REQUEST_CHANGES'
        ? '--request-changes'
        : '--comment'
  const args = ['pr', 'review', String(number), '--repo', repo, flag]
  if (body) args.push('--body', body)
  await execFileAsync('gh', args)
}

export async function mergePR(
  repo: string,
  number: number,
  method: MergeMethod,
): Promise<void> {
  const flag = method === 'squash' ? '--squash' : method === 'rebase' ? '--rebase' : '--merge'
  await execFileAsync('gh', ['pr', 'merge', String(number), '--repo', repo, flag])
}

export async function createPR(repo: string, params: CreatePRParams): Promise<PRSummary> {
  const args = [
    'pr', 'create',
    '--repo', repo,
    '--title', params.title,
    '--body', params.body,
    '--head', params.head,
    '--base', params.base,
  ]
  if (params.draft) args.push('--draft')

  const { stdout } = await execFileAsync('gh', args)
  // stdout is the PR URL, e.g. https://github.com/owner/repo/pull/123
  const match = /\/pull\/(\d+)/.exec(stdout.trim())
  if (!match) throw new Error(`gh pr create: unexpected output: ${stdout.trim()}`)
  const prNumber = Number(match[1])
  // Fetch the full PR summary
  const { stdout: viewOut } = await execFileAsync('gh', [
    'pr', 'view', String(prNumber),
    '--repo', repo,
    '--json', PR_SUMMARY_FIELDS,
  ])
  return mapToPRSummary(JSON.parse(viewOut.trim()) as RawGHPR, repo)
}
