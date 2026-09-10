import type { WorkItem, WorkItemProvider, WorkItemStatus } from '@agentkeeper/sdk'
import { closeIssue, getIssue, getPR, listIssues, reopenIssue } from './github-cli.js'
import type { GHIssue, PRDetail } from './types.js'

function itemId(repo: string, number: number): string {
  return `${repo}#${number}`
}

function parseItemId(id: string): { repo: string; number: number } | null {
  const separator = id.lastIndexOf('#')
  if (separator < 1) return null
  const number = Number(id.slice(separator + 1))
  return Number.isInteger(number) ? { repo: id.slice(0, separator), number } : null
}

function mapToWorkItem(issue: GHIssue, repo: string): WorkItem {
  const status: WorkItemStatus = issue.state?.toUpperCase() === 'CLOSED' ? 'closed' : 'open'
  return {
    id: itemId(repo, issue.number),
    source: 'github',
    externalRef: `${repo}#${issue.number}`,
    title: issue.title,
    body: issue.body ?? '',
    status,
    statusLabel: status === 'closed' ? 'Closed' : 'Open',
    ...(issue.assignees?.[0] ? { assignee: issue.assignees[0].login } : {}),
    links: [{ type: 'related', url: issue.url, label: 'GitHub' }],
  }
}

function mapPullRequestToWorkItem(pull: PRDetail): WorkItem {
  const status: WorkItemStatus = pull.state === 'open' ? 'open' : pull.state === 'merged' ? 'done' : 'closed'
  return {
    id: itemId(pull.repo, pull.number), source: 'github', externalRef: `${pull.repo}#${pull.number}`,
    title: pull.title, body: pull.body, status, statusLabel: pull.state === 'merged' ? 'Merged' : pull.state === 'closed' ? 'Closed' : 'Open',
    links: [{ type: 'pr', url: pull.url, label: 'GitHub pull request' }],
  }
}

export class GitHubWorkItemProvider implements WorkItemProvider {
  readonly id = 'github'
  readonly label = 'GitHub'

  private cache: WorkItem[] = []
  private readonly repos: string[]

  constructor(repos: string[]) {
    this.repos = repos
  }

  async list(): Promise<WorkItem[]> {
    if (this.cache.length === 0) await this.refresh()
    return this.cache
  }

  async get(id: string): Promise<WorkItem | undefined> {
    const cached = this.cache.find((i) => i.id === id)
    if (cached) return cached
    const parsed = parseItemId(id)
    if (!parsed || !this.repos.includes(parsed.repo)) return undefined
    try {
      const issue = await getIssue(parsed.repo, parsed.number)
      return mapToWorkItem(issue, parsed.repo)
    } catch {
      try { return mapPullRequestToWorkItem(await getPR(parsed.repo, parsed.number)) }
      catch { return undefined }
    }
  }

  async updateStatus(id: string, status: WorkItemStatus): Promise<void> {
    const parsed = parseItemId(id)
    if (!parsed || !this.repos.includes(parsed.repo)) throw new Error('Unknown GitHub work item')
    if (status === 'closed' || status === 'done') {
      await closeIssue(parsed.repo, parsed.number)
    } else {
      await reopenIssue(parsed.repo, parsed.number)
    }
  }

  async refresh(): Promise<void> {
    try {
      const results = await Promise.allSettled(this.repos.map(async (repo) => ({ repo, issues: await listIssues(repo, 'open') })))
      this.cache = results.flatMap((result) => result.status === 'fulfilled'
        ? result.value.issues.map((issue) => mapToWorkItem(issue, result.value.repo))
        : [])
    } catch (err) {
      console.error('[github] refresh failed:', err)
    }
  }
}
