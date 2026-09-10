import type { PluginContext } from '@agentkeeper/sdk'
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

let githubFetch: PluginContext['fetch'] | null = null
let githubToken = ''

export function configureGitHubApi(fetch: PluginContext['fetch'], token?: string): void {
  githubFetch = fetch
  githubToken = token?.trim() ?? ''
}

export function githubCredentialsPresent(): boolean {
  return Boolean(githubFetch && githubToken)
}

async function githubRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!githubCredentialsPresent()) throw new Error('Add a GitHub access token in GitHub settings.')
  const response = await githubFetch!(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${githubToken}`,
      'x-github-api-version': '2022-11-28',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`GitHub API ${response.status}: ${detail || response.statusText}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function checkConnection(): Promise<boolean> {
  try {
    await githubRequest('/user')
    return true
  } catch {
    return false
  }
}

export async function testConnectionWith(fetch: PluginContext['fetch'], token: string): Promise<{ login: string }> {
  const normalized = token.trim()
  if (!normalized) throw new Error('Enter a GitHub access token.')
  const response = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${normalized}`,
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`GitHub API ${response.status}: ${detail || response.statusText}`)
  }
  const user = await response.json() as { login?: string }
  return { login: user.login ?? 'GitHub user' }
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
  const { owner, repoName } = splitRepo(repo)
  const query = new URLSearchParams({ state, per_page: '100' })
  const rows = await githubRequest<Array<Record<string, unknown>>>(`/repos/${owner}/${repoName}/issues?${query}`)
  return rows.filter(row => !row.pull_request).map(mapRestIssue)
}

export async function getIssue(repo: string, number: number): Promise<GHIssue> {
  const { owner, repoName } = splitRepo(repo)
  return mapRestIssue(await githubRequest<Record<string, unknown>>(`/repos/${owner}/${repoName}/issues/${number}`))
}

export async function closeIssue(repo: string, number: number): Promise<void> {
  await updateIssueState(repo, number, 'closed')
}

export async function reopenIssue(repo: string, number: number): Promise<void> {
  await updateIssueState(repo, number, 'open')
}

function mapRestIssue(row: Record<string, unknown>): GHIssue {
  const user = row.user as { login?: string } | null
  return {
    number: Number(row.number), title: String(row.title ?? ''), body: String(row.body ?? ''),
    state: String(row.state ?? 'open').toUpperCase(), author: { login: user?.login ?? '' },
    assignees: ((row.assignees as Array<{ login?: string }> | undefined) ?? []).map(value => ({ login: value.login ?? '' })),
    labels: ((row.labels as Array<{ name?: string }> | undefined) ?? []).map(value => ({ name: value.name ?? '' })),
    url: String(row.html_url ?? ''), createdAt: String(row.created_at ?? ''), updatedAt: String(row.updated_at ?? ''),
  }
}

async function updateIssueState(repo: string, number: number, state: 'open' | 'closed'): Promise<void> {
  const { owner, repoName } = splitRepo(repo)
  await githubRequest(`/repos/${owner}/${repoName}/issues/${number}`, { method: 'PATCH', body: JSON.stringify({ state }) })
}

// ─── PRs — list + detail ─────────────────────────────────────────────────────

export async function listPRs(repo: string, filters: PRFilters): Promise<PRSummary[]> {
  const { owner, repoName } = splitRepo(repo)
  const query = new URLSearchParams({ state: filters.state === 'merged' ? 'closed' : filters.state ?? 'open', per_page: '100' })
  const rows = await githubRequest<Array<Record<string, unknown>>>(`/repos/${owner}/${repoName}/pulls?${query}`)
  let results = rows.map(row => mapRestPR(row, repo))

  if (filters.state === 'merged') results = results.filter(pr => pr.state === 'merged')
  if (filters.author) results = results.filter(pr => pr.author === filters.author)
  if (filters.label) results = results.filter(pr => pr.labels.includes(filters.label!))
  if (filters.search) results = results.filter(pr => `${pr.title} ${pr.number}`.toLowerCase().includes(filters.search!.toLowerCase()))

  if (filters.checksState) {
    results = results.filter((pr) => pr.checksState === filters.checksState)
  }

  return results
}

export async function getPR(repo: string, number: number): Promise<PRDetail> {
  const { owner, repoName } = splitRepo(repo)
  const [row, issueComments, reviewComments, reviews] = await Promise.all([
    githubRequest<Record<string, unknown>>(`/repos/${owner}/${repoName}/pulls/${number}`),
    fetchAPIComments(repo, number, 'issues'),
    fetchAPIComments(repo, number, 'pulls'),
    githubRequest<Array<Record<string, unknown>>>(`/repos/${owner}/${repoName}/pulls/${number}/reviews`),
  ])

  const allComments: PRComment[] = [
    ...issueComments.map((c) => mapAPIComment(c)),
    ...reviewComments.map((c) => mapAPIComment(c)),
  ].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  return {
    ...mapRestPR(row, repo),
    body: String(row.body ?? ''), additions: Number(row.additions ?? 0), deletions: Number(row.deletions ?? 0), changedFiles: Number(row.changed_files ?? 0),
    mergeable: row.mergeable === true ? 'MERGEABLE' : row.mergeable === false ? 'CONFLICTING' : 'UNKNOWN',
    comments: allComments,
    reviews: reviews.map(mapRestReview),
  }
}

function mapRestPR(row: Record<string, unknown>, repo: string): PRSummary {
  const user = row.user as { login?: string } | null
  const head = row.head as { ref?: string } | null
  const base = row.base as { ref?: string } | null
  return {
    number: Number(row.number), title: String(row.title ?? ''),
    state: row.merged_at ? 'merged' : String(row.state ?? 'open') === 'closed' ? 'closed' : 'open',
    isDraft: Boolean(row.draft), author: user?.login ?? '', headRef: head?.ref ?? '', baseRef: base?.ref ?? '',
    reviewDecision: null, checksState: null, updatedAt: String(row.updated_at ?? ''), url: String(row.html_url ?? ''),
    labels: ((row.labels as Array<{ name?: string }> | undefined) ?? []).map(label => label.name ?? ''), repo,
  }
}

function mapRestReview(row: Record<string, unknown>): PRReview {
  const user = row.user as { login?: string } | null
  const state = String(row.state ?? 'COMMENTED') as PRReview['state']
  return { id: Number(row.id), author: user?.login ?? '', state, body: String(row.body ?? ''), submittedAt: String(row.submitted_at ?? '') }
}

async function fetchAPIComments(
  repo: string,
  number: number,
  kind: 'issues' | 'pulls',
): Promise<RawAPIComment[]> {
  const { owner, repoName } = splitRepo(repo)
  const endpoint = `/repos/${owner}/${repoName}/${kind}/${number}/comments?per_page=100`
  try {
    return await githubRequest<RawAPIComment[]>(endpoint)
  } catch {
    return []
  }
}

// ─── PR content ───────────────────────────────────────────────────────────────

export async function getPRDiff(repo: string, number: number): Promise<string> {
  const { owner, repoName } = splitRepo(repo)
  if (!githubCredentialsPresent()) throw new Error('Add a GitHub access token in GitHub settings.')
  const response = await githubFetch!(`https://api.github.com/repos/${owner}/${repoName}/pulls/${number}`, { headers: { accept: 'application/vnd.github.diff', authorization: `Bearer ${githubToken}`, 'x-github-api-version': '2022-11-28' } })
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text()}`)
  return response.text()
}

export async function getPRChecks(repo: string, number: number): Promise<CheckRun[]> {
  const { owner, repoName } = splitRepo(repo)
  const pr = await githubRequest<{ head: { sha: string } }>(`/repos/${owner}/${repoName}/pulls/${number}`)
  const result = await githubRequest<{ check_runs: Array<{ name: string; status: string; conclusion: string | null; details_url?: string }> }>(`/repos/${owner}/${repoName}/commits/${pr.head.sha}/check-runs?per_page=100`)
  return result.check_runs.map(check => mapCheckItem({ __typename: 'CheckRun', name: check.name, status: check.status, conclusion: check.conclusion ?? undefined, detailsUrl: check.details_url }))
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
  const { owner, repoName } = splitRepo(repo)
  await githubRequest(`/repos/${owner}/${repoName}/issues/${number}/comments`, { method: 'POST', body: JSON.stringify({ body }) })
}

export async function submitReview(
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
): Promise<void> {
  const { owner, repoName } = splitRepo(repo)
  await githubRequest(`/repos/${owner}/${repoName}/pulls/${number}/reviews`, { method: 'POST', body: JSON.stringify({ event, body }) })
}

export async function mergePR(
  repo: string,
  number: number,
  method: MergeMethod,
): Promise<void> {
  const { owner, repoName } = splitRepo(repo)
  await githubRequest(`/repos/${owner}/${repoName}/pulls/${number}/merge`, { method: 'PUT', body: JSON.stringify({ merge_method: method }) })
}

export async function createPR(repo: string, params: CreatePRParams): Promise<PRSummary> {
  const { owner, repoName } = splitRepo(repo)
  const row = await githubRequest<Record<string, unknown>>(`/repos/${owner}/${repoName}/pulls`, { method: 'POST', body: JSON.stringify({ title: params.title, body: params.body, head: params.head, base: params.base, draft: params.draft ?? false }) })
  return mapRestPR(row, repo)
}
