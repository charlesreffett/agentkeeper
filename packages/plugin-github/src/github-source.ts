import type { WorkItem, WorkItemSource, WorkItemStatus } from '@agentkeeper/sdk'
import { closeIssue, getIssue, listIssues, reopenIssue } from './github-cli.js'
import type { GHIssue } from './types.js'

function mapToWorkItem(issue: GHIssue, _repo: string): WorkItem {
  const status: WorkItemStatus = issue.state?.toUpperCase() === 'CLOSED' ? 'closed' : 'open'
  return {
    id: String(issue.number),
    source: 'github',
    externalRef: `#${issue.number}`,
    title: issue.title,
    body: issue.body ?? '',
    status,
    statusLabel: status === 'closed' ? 'Closed' : 'Open',
    ...(issue.assignees?.[0] ? { assignee: issue.assignees[0].login } : {}),
    links: [{ type: 'related', url: issue.url, label: 'GitHub' }],
  }
}

export class GitHubWorkItemSource implements WorkItemSource {
  readonly id = 'github'
  readonly label = 'GitHub'

  private cache: WorkItem[] = []
  private readonly repo: string

  constructor(repo: string) {
    this.repo = repo
  }

  async list(): Promise<WorkItem[]> {
    if (this.cache.length === 0) await this.refresh()
    return this.cache
  }

  async get(id: string): Promise<WorkItem | undefined> {
    const cached = this.cache.find((i) => i.id === id)
    if (cached) return cached
    try {
      const issue = await getIssue(this.repo, Number(id))
      return mapToWorkItem(issue, this.repo)
    } catch {
      return undefined
    }
  }

  async updateStatus(id: string, status: WorkItemStatus): Promise<void> {
    const number = Number(id)
    if (status === 'closed' || status === 'done') {
      await closeIssue(this.repo, number)
    } else {
      await reopenIssue(this.repo, number)
    }
  }

  async refresh(): Promise<void> {
    try {
      const issues = await listIssues(this.repo, 'open')
      this.cache = issues.map((i) => mapToWorkItem(i, this.repo))
    } catch (err) {
      console.error('[github] refresh failed:', err)
    }
  }
}
