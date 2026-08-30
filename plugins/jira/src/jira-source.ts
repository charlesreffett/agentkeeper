import type { IssueTransition, WorkItem, WorkItemCreateParams, WorkItemSource, WorkItemStatus } from '@agentkeeper/sdk'
import {
  addComment as cliAddComment,
  createIssue,
  getFieldMeta,
  getIssue,
  getIssueTransitions,
  listIssues,
  mapToWorkItem,
  transitionIssue,
  updateIssueStatus,
} from './jira-cli.js'

export class JiraWorkItemSource implements WorkItemSource {
  readonly id = 'jira'
  readonly label = 'Jira'

  private cache: WorkItem[] = []
  private lastError: Error | null = null

  constructor(
    private projectKeys: string[] = [],
    private legacyProjectKey?: string,
  ) {}

  async list(): Promise<WorkItem[]> {
    if (this.cache.length === 0) {
      await this.refresh()
    }
    // Empty cache after a failed fetch must surface the error, not masquerade as "no issues"
    if (this.cache.length === 0 && this.lastError) throw this.lastError
    return this.cache
  }

  async get(id: string): Promise<WorkItem | undefined> {
    const [raw, fieldMeta] = await Promise.all([getIssue(id), getFieldMeta().catch(() => new Map<string, string>())])
    return raw ? mapToWorkItem(raw, fieldMeta) : undefined
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
    const key = this.legacyProjectKey ?? this.projectKeys[0]
    if (!key) throw new Error('No Jira project key configured — add a mapping in Jira settings.')
    const raw = await createIssue(key, params)
    const item = mapToWorkItem(raw)
    this.cache.push(item)
    return item
  }

  async refresh(): Promise<void> {
    const keys = this.projectKeys
    const fieldMeta = await getFieldMeta().catch(() => new Map<string, string>())
    try {
      if (keys.length > 0) {
        // Per-board so one inaccessible project can't wipe out every other board's issues
        const results = await Promise.allSettled(keys.map((k) => listIssues(k)))
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        if (failures.length === results.length) throw failures[0]!.reason
        const raw = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
        this.cache = raw.map((r) => mapToWorkItem(r, fieldMeta))
      } else if (this.legacyProjectKey) {
        this.cache = (await listIssues(this.legacyProjectKey)).map((r) => mapToWorkItem(r, fieldMeta))
      } else {
        this.cache = (await listIssues()).map((r) => mapToWorkItem(r, fieldMeta))
      }
      this.lastError = null
    } catch (err) {
      // Log but don't rethrow — background pollers must not crash; list() reads lastError
      this.lastError = err instanceof Error ? err : new Error(String(err))
      console.error('[jira] refresh failed:', this.lastError)
    }
  }
}
