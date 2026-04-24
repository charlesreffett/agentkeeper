import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkItem, WorkItemStatus } from '@orchestral/sdk'

const statusToJira: Record<WorkItemStatus, string> = {
  open: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

const statusKeywords: Record<WorkItemStatus, string[]> = {
  in_progress: ['progress', 'work', 'start'],
  done: ['done', 'resolved', 'complete', 'fixed'],
  closed: ['closed', 'close'],
  open: ['open', 'todo', 'to do', 'backlog'],
  in_review: ['review', 'testing', 'qa'],
}

const execFileAsync = promisify(execFile)

export interface RawJiraIssue {
  key: string
  summary?: string
  description?: string
  status?: { name: string }
  assignee?: { displayName: string }
  issuetype?: { name: string; iconUrl?: string }
  fields?: {
    summary?: string
    description?: string
    status?: {
      name: string
      statusCategory?: { name: string }
    }
    assignee?: { displayName: string }
    issuetype?: { name: string; iconUrl?: string }
    issueType?: { name: string; iconUrl?: string }
  }
}

export async function checkCliPresent(): Promise<boolean> {
  try {
    await execFileAsync('jira', ['version'])
    return true
  } catch {
    return false
  }
}

function mapStatus(
  statusField: { name?: string; statusCategory?: { name?: string } } | undefined,
): WorkItemStatus {
  switch (statusField?.name) {
    case 'To Do':
    case 'Open':
    case 'Reopened':
      return 'open'
    case 'In Progress':
      return 'in_progress'
    case 'In Review':
    case 'Under Review':
    case 'In Testing':
    case 'In QA':
    case 'QA':
    case 'Testing':
      return 'in_review'
    case 'Done':
    case 'Resolved':
    case 'Fixed':
    case 'Completed':
    case 'Accepted':
    case 'Verified':
    case 'Released':
      return 'done'
    case 'Closed':
    case "Won't Do":
      return 'closed'
    default: {
      const cat = statusField?.statusCategory?.name
      if (cat === 'Done') return 'done'
      if (cat === 'In Progress') return 'in_progress'
      return 'open'
    }
  }
}

export function mapToWorkItem(raw: RawJiraIssue): WorkItem {
  const summary = raw.fields?.summary ?? raw.summary ?? raw.key
  const description = raw.fields?.description ?? raw.description ?? ''
  const assignee = raw.fields?.assignee?.displayName ?? raw.assignee?.displayName
  const issueType = raw.fields?.issuetype?.name ?? raw.fields?.issueType?.name ?? raw.issuetype?.name
  return {
    id: raw.key,
    source: 'jira',
    externalRef: raw.key,
    title: summary,
    body: typeof description === 'string' ? description : '',
    status: mapStatus(raw.fields?.status ?? raw.status),
    ...(assignee ? { assignee } : {}),
    ...(issueType ? { issueType } : {}),
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

export async function getIssueTransitions(id: string): Promise<string[]> {
  try {
    await execFileAsync('jira', ['issue', 'move', id, '__probe__'])
    return []
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string }).stderr ?? ''
    const match = stderr.match(/Available states for issue [^:]+: (.+)/)
    const statesStr = match?.[1]
    if (!statesStr) return []
    return statesStr.match(/'([^']+)'/g)?.map((s) => s.slice(1, -1)) ?? []
  }
}

export async function transitionIssue(id: string, name: string): Promise<void> {
  await execFileAsync('jira', ['issue', 'move', id, name])
}

export async function updateIssueStatus(id: string, status: WorkItemStatus): Promise<void> {
  const transitions = await getIssueTransitions(id)
  if (transitions.length === 0) {
    await execFileAsync('jira', ['issue', 'move', id, statusToJira[status]])
    return
  }

  const target = statusToJira[status]
  const exact = transitions.find((t) => t === target)
  if (exact) { await transitionIssue(id, exact); return }

  const ci = transitions.find((t) => t.toLowerCase() === target.toLowerCase())
  if (ci) { await transitionIssue(id, ci); return }

  const keywords = statusKeywords[status]
  const keyword = transitions.find((t) =>
    keywords.some((k) => t.toLowerCase().includes(k)),
  )
  if (keyword) { await transitionIssue(id, keyword); return }

  throw new Error(
    `No matching transition for '${status}'. Available: ${transitions.map((t) => `'${t}'`).join(', ')}`,
  )
}

export async function addComment(id: string, body: string): Promise<void> {
  await execFileAsync('jira', ['issue', 'comment', 'add', id, '-b', body])
}
