import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { IssueTransition, WorkItem, WorkItemCreateParams, WorkItemStatus } from '@agentkeeper/sdk'

const toStatusDisplayLabel: Record<WorkItemStatus, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

const execFileAsync = (file: string, args: string[]) =>
  promisify(execFile)(file, args, { timeout: 10_000 })

export interface JiraProject {
  key: string
  name: string
}

export async function listProjects(): Promise<JiraProject[]> {
  try {
    const { stdout } = await execFileAsync('jira', ['project', 'list'])
    return stdout
      .split('\n')
      .slice(1)
      .map((line) => line.split('\t').map((p) => p.trim()))
      .filter((parts) => parts[0] && parts[0].length > 0)
      .map((parts) => ({ key: parts[0]!, name: parts[1] ?? parts[0]! }))
  } catch {
    return []
  }
}

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
    reporter?: { displayName: string }
    priority?: { name: string }
    story_points?: number
    customfield_10016?: number
    issuetype?: { name: string; iconUrl?: string }
    issueType?: { name: string; iconUrl?: string }
    parent?: { key: string; fields?: { summary?: string } }
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
      return 'backlog'
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

export function mapToWorkItem(raw: RawJiraIssue, fieldMeta?: Map<string, string>): WorkItem {
  const summary = raw.fields?.summary ?? raw.summary ?? raw.key
  const rawDesc = raw.fields?.description ?? raw.description ?? ''
  const description = typeof rawDesc === 'string' ? rawDesc : extractADFText(rawDesc)
  const assignee = raw.fields?.assignee?.displayName ?? raw.assignee?.displayName
  const reporter = raw.fields?.reporter?.displayName
  const priority = raw.fields?.priority?.name
  const storyPoints = raw.fields?.story_points ?? raw.fields?.customfield_10016
  const issueType = raw.fields?.issuetype?.name ?? raw.fields?.issueType?.name ?? raw.issuetype?.name
  const parentRef = raw.fields?.parent?.key

  const customFields: Record<string, string> = {}
  if (raw.fields) {
    for (const [key, value] of Object.entries(raw.fields)) {
      if (!key.startsWith('customfield_')) continue
      if (value == null) continue
      if (key === 'customfield_10016') continue
      const name = fieldMeta?.get(key) ?? key
      const text =
        typeof value === 'string' ? value
        : typeof value === 'number' ? String(value)
        : typeof value === 'object' ? extractADFText(value).trim()
        : null
      if (text && text.trim()) customFields[name] = text.trim()
    }
  }

  return {
    id: raw.key,
    source: 'jira',
    externalRef: raw.key,
    title: summary,
    body: description,
    status: mapStatus(raw.fields?.status ?? raw.status),
    statusLabel: raw.fields?.status?.name ?? raw.status?.name,
    ...(assignee ? { assignee } : {}),
    ...(reporter ? { reporter } : {}),
    ...(priority ? { priority } : {}),
    ...(storyPoints != null ? { storyPoints } : {}),
    ...(issueType ? { issueType } : {}),
    ...(parentRef ? { parentRef } : {}),
    ...(Object.keys(customFields).length > 0 ? { customFields } : {}),
    links: [],
  }
}

export async function createIssue(
  projectKey: string,
  params: WorkItemCreateParams,
): Promise<RawJiraIssue> {
  const args = ['issue', 'create', '--project', projectKey, '--summary', params.summary, '--no-input', '--raw']
  if (params.description) args.push('--description', params.description)
  if (params.issueType) args.push('--type', params.issueType)
  if (params.priority) args.push('--priority', params.priority)
  const { stdout } = await execFileAsync('jira', args)
  return JSON.parse(stdout.trim()) as RawJiraIssue
}

const LIST_PAGE_SIZE = 100
const LIST_MAX_ITEMS = 500

export async function listIssues(
  projectKey?: string,
  { excludeDone = true, maxItems = LIST_MAX_ITEMS }: { excludeDone?: boolean; maxItems?: number } = {},
): Promise<RawJiraIssue[]> {
  const all: RawJiraIssue[] = []
  let from = 0

  while (true) {
    const limit = Math.min(LIST_PAGE_SIZE, maxItems - all.length)
    if (limit <= 0) break
    const args = ['issue', 'list', '--raw', '--paginate', `${from}:${limit}`]
    if (projectKey) args.push('--project', projectKey)
    if (excludeDone) args.push('--jql', 'statusCategory != Done')
    const { stdout } = await execFileAsync('jira', args)
    const page = JSON.parse(stdout.trim()) as RawJiraIssue[]
    all.push(...page)
    if (page.length < limit) break
    from += page.length
  }

  return all
}

interface JiraAuth {
  server: string
  login: string
  token: string
}

function extractADFText(node: unknown): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  const children = Array.isArray(n.content)
    ? (n.content as unknown[]).map(extractADFText).join('')
    : ''
  const blockTypes = ['paragraph', 'heading', 'listItem', 'bulletList', 'orderedList',
    'blockquote', 'codeBlock', 'rule', 'mediaGroup', 'mediaSingle']
  return blockTypes.includes(n.type as string) ? children + '\n' : children
}

// jira CLI stores server/login in its YAML config; the API token lives in JIRA_API_TOKEN
// (same source the CLI reads). Parsed by line, not full YAML, to avoid a yaml dependency.
function readJiraAuth(): JiraAuth | null {
  const token = process.env.JIRA_API_TOKEN
  if (!token) return null
  const cfgPath =
    process.env.JIRA_CONFIG_FILE ?? join(homedir(), '.config', '.jira', '.config.yml')
  try {
    const text = readFileSync(cfgPath, 'utf8')
    const server = text.match(/^server:\s*(.+)$/m)?.[1]?.trim()
    const login = text.match(/^login:\s*(.+)$/m)?.[1]?.trim()
    if (!server || !login) return null
    return { server, login, token }
  } catch {
    return null
  }
}

let fieldMetaCache: Map<string, string> | null = null

export async function getFieldMeta(): Promise<Map<string, string>> {
  if (fieldMetaCache) return fieldMetaCache
  const auth = readJiraAuth()
  if (!auth) { fieldMetaCache = new Map(); return fieldMetaCache }
  try {
    const res = await fetch(`${auth.server}/rest/api/3/field`, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${auth.login}:${auth.token}`).toString('base64'),
      },
    })
    if (!res.ok) { fieldMetaCache = new Map(); return fieldMetaCache }
    const fields = (await res.json()) as Array<{ id: string; name: string }>
    fieldMetaCache = new Map(fields.map((f) => [f.id, f.name]))
  } catch {
    fieldMetaCache = new Map()
  }
  return fieldMetaCache
}

// True board total via Jira Cloud's approximate-count endpoint — the CLI list output
// carries no total, so this is the only cheap way to count without fetching every page.
// Returns null when auth is unavailable or the request fails (callers fall back to the
// loaded/capped count).
export async function countIssues(
  projectKey?: string,
  { excludeDone = true }: { excludeDone?: boolean } = {},
): Promise<number | null> {
  const auth = readJiraAuth()
  if (!auth) return null

  const clauses: string[] = []
  if (projectKey) clauses.push(`project = ${projectKey}`)
  if (excludeDone) clauses.push('statusCategory != Done')
  const jql = clauses.join(' AND ')

  try {
    const res = await fetch(`${auth.server}/rest/api/3/search/approximate-count`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${auth.login}:${auth.token}`).toString('base64'),
      },
      body: JSON.stringify({ jql }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { count?: number }
    return typeof data.count === 'number' ? data.count : null
  } catch {
    return null
  }
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
    await execFileAsync('jira', ['issue', 'move', id, '__JIRA_TRANSITION_PROBE__'])
    return []
  } catch (err: unknown) {
    const output =
      (err as { stderr?: string }).stderr ??
      (err as { message?: string }).message ??
      ''
    const match = output.match(/Available states for issue [^:]+:\s*(.+)/)
    if (!match) return []
    const stateNames = [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    return stateNames.map((name) => {
      const toStatus = mapStatus({ name })
      return { name, toStatus, toStatusLabel: toStatusDisplayLabel[toStatus] }
    })
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
