import type { IssueTransition, WorkItem, WorkItemSource, WorkItemStatus } from '@orchestral/sdk'
import {
  addComment as cliAddComment,
  getIssue,
  getIssueTransitions,
  listIssues,
  mapToWorkItem,
  transitionIssue,
  updateIssueStatus,
} from './jira-cli'

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
    await updateIssueStatus(id, status)
  }

  async addComment(id: string, body: string): Promise<void> {
    await cliAddComment(id, body)
  }

  async getTransitions(id: string): Promise<IssueTransition[]> {
    return getIssueTransitions(id)
  }

  async transition(id: string, name: string): Promise<void> {
    await transitionIssue(id, name)
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
