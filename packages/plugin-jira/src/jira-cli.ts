import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkItem, WorkItemStatus } from '@orchestral/sdk'

const execFileAsync = promisify(execFile)

export interface RawJiraIssue {
  key: string
  summary: string
  description?: string
  status?: { name: string }
  assignee?: { displayName: string }
}

export async function checkCliPresent(): Promise<boolean> {
  try {
    await execFileAsync('jira', ['version'])
    return true
  } catch {
    return false
  }
}

function mapStatus(jiraStatus: string | undefined): WorkItemStatus {
  switch (jiraStatus) {
    case 'To Do':
    case 'Open':
      return 'open'
    case 'In Progress':
      return 'in_progress'
    case 'In Review':
    case 'Under Review':
      return 'in_review'
    case 'Done':
      return 'done'
    case 'Closed':
    case "Won't Do":
      return 'closed'
    default:
      return 'open'
  }
}

export function mapToWorkItem(raw: RawJiraIssue): WorkItem {
  return {
    id: raw.key,
    source: 'jira',
    externalRef: raw.key,
    title: raw.summary ?? raw.key,
    body: raw.description ?? '',
    status: mapStatus(raw.status?.name),
    ...(raw.assignee?.displayName ? { assignee: raw.assignee.displayName } : {}),
    links: [],
  }
}

export async function listIssues(projectKey?: string): Promise<RawJiraIssue[]> {
  const args = ['issue', 'list', '--raw']
  if (projectKey) args.push('--project', projectKey)
  const { stdout } = await execFileAsync('jira', args)
  return JSON.parse(stdout.trim()) as RawJiraIssue[]
}

export async function getIssue(id: string): Promise<RawJiraIssue | undefined> {
  try {
    const { stdout } = await execFileAsync('jira', ['issue', 'view', id, '--raw'])
    return JSON.parse(stdout.trim()) as RawJiraIssue
  } catch {
    return undefined
  }
}

export async function updateIssueStatus(id: string, status: string): Promise<void> {
  await execFileAsync('jira', ['issue', 'move', id, status])
}
