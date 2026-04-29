import type { IssueTransition, WorkItem, WorkItemCreateParams, WorkItemSource, WorkItemStatus } from '@agentkeeper/sdk'
import {
  addComment as cliAddComment,
  createIssue,
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

  async create(params: WorkItemCreateParams): Promise<WorkItem> {
    const key = this.projectKey
    if (!key) throw new Error('Set a project key in Jira settings before creating issues.')
    const raw = await createIssue(key, params)
    const item = mapToWorkItem(raw)
    this.cache.push(item)
    return item
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
