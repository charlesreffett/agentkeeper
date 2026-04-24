import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IssueTransition, WorkItem, WorkItemStatus } from '@orchestral/sdk'

const toStatusDisplayLabel: Record<WorkItemStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
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
    case 'Backlog':
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
    statusLabel: raw.fields?.status?.name ?? raw.status?.name,
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

export async function getIssueTransitions(id: string): Promise<IssueTransition[]> {
  try {
    const { stdout } = await execFileAsync('jira', [
      'api', `/rest/api/2/issue/${id}/transitions`,
    ])
    const data = JSON.parse(stdout.trim()) as {
      transitions: Array<{
        name: string
        to: { name?: string; statusCategory?: { name?: string } }
      }>
    }
    return data.transitions.map((t) => {
      const toStatus = mapStatus(t.to)
      return {
        name: t.name,
        toStatus,
        toStatusLabel: toStatusDisplayLabel[toStatus],
      }
    })
  } catch (err) {
    console.error('[jira] getIssueTransitions failed:', err)
    return []
  }
}

export async function transitionIssue(id: string, name: string): Promise<void> {
  await execFileAsync('jira', ['issue', 'move', id, name])
}

export async function updateIssueStatus(id: string, status: WorkItemStatus): Promise<void> {
  let transitions = await getIssueTransitions(id)

  // No transitions → issue is likely in the backlog (not on the board).
  // Try common backlog-exit transition names to move it to 'open' first.
  if (transitions.length === 0) {
    for (const name of ['To Do', 'Open', 'Reopen']) {
      try {
        await transitionIssue(id, name)
        break
      } catch {
        // try next
      }
    }
    transitions = await getIssueTransitions(id)
  }

  // Direct path
  const match = transitions.find((t) => t.toStatus === status)
  if (match) {
    await transitionIssue(id, match.name)
    return
  }

  // Two-step path: go through 'open' as an intermediate (e.g. backlog → open → in_progress)
  if (status !== 'open') {
    const openMatch = transitions.find((t) => t.toStatus === 'open')
    if (openMatch) {
      await transitionIssue(id, openMatch.name)
      const nextTransitions = await getIssueTransitions(id)
      const nextMatch = nextTransitions.find((t) => t.toStatus === status)
      if (nextMatch) {
        await transitionIssue(id, nextMatch.name)
        return
      }
    }
  }

  if (transitions.length === 0) {
    throw new Error(
      `No transitions are available from the current status. This issue may need to be moved onto the board in Jira first.`,
    )
  }
  throw new Error(
    `No direct path to '${status}'. Available: ${transitions.map((t) => t.toStatusLabel).join(', ')}. If '${status}' is reachable via an intermediate step, transition to an available status first.`,
  )
}

export async function addComment(id: string, body: string): Promise<void> {
  await execFileAsync('jira', ['issue', 'comment', 'add', id, '-b', body])
}
