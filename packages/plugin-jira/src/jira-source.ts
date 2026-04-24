import type { WorkItem, WorkItemSource, WorkItemStatus } from '@orchestral/sdk'
import { getIssue, listIssues, mapToWorkItem, updateIssueStatus } from './jira-cli'

function statusToJira(status: WorkItemStatus): string {
  switch (status) {
    case 'open':
      return 'To Do'
    case 'in_progress':
      return 'In Progress'
    case 'in_review':
      return 'In Review'
    case 'done':
      return 'Done'
    case 'closed':
      return 'Closed'
  }
}

export class JiraWorkItemSource implements WorkItemSource {
  readonly id = 'jira'
  readonly label = 'Jira'

  private cache: WorkItem[] = []
  private readonly projectKey: string | undefined

  constructor(projectKey?: string) {
    this.projectKey = projectKey
  }

  async list(): Promise<WorkItem[]> {
    if (this.cache.length === 0) {
      await this.refresh()
    }
    return this.cache
  }

  async get(id: string): Promise<WorkItem | undefined> {
    const cached = this.cache.find((i) => i.id === id)
    if (cached) return cached
    const raw = await getIssue(id)
    return raw ? mapToWorkItem(raw) : undefined
  }

  async updateStatus(id: string, status: WorkItemStatus): Promise<void> {
    await updateIssueStatus(id, statusToJira(status))
  }

  async refresh(): Promise<void> {
    try {
      const raw = await listIssues(this.projectKey)
      this.cache = raw.map(mapToWorkItem)
    } catch (err) {
      console.error('[jira] refresh failed:', err)
    }
  }
}
