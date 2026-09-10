import type { IssueTransition, PluginContext, StatusCategory, WorkItem, WorkItemCreateParams, WorkItemStatus } from '@agentkeeper/sdk'

// Jira statusCategory.key (platform constant) → SDK StatusCategory. Deterministic across
// orgs/boards; the only reliable color source since status names are arbitrary.
function mapStatusCategory(key?: string): StatusCategory {
  switch (key) {
    case 'new':
      return 'todo'
    case 'indeterminate':
      return 'in-progress'
    case 'done':
      return 'done'
    default:
      return 'unknown'
  }
}

const toStatusDisplayLabel: Record<WorkItemStatus, string> = {
  backlog: 'Backlog',
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

let jiraFetch: PluginContext['fetch'] | null = null
let jiraBaseUrl = ''
let jiraEmail = ''
let jiraApiToken = ''

export function configureJiraApi(options: {
  fetch: PluginContext['fetch']
  instanceUrl?: string
  email?: string
  apiToken?: string
}): void {
  jiraFetch = options.fetch
  jiraBaseUrl = options.instanceUrl?.trim().replace(/\/+$/, '') ?? ''
  jiraEmail = options.email?.trim() ?? ''
  jiraApiToken = options.apiToken?.trim() ?? ''
}

export function jiraCredentialsPresent(): boolean {
  return Boolean(jiraFetch && jiraBaseUrl && jiraEmail && jiraApiToken)
}

async function jiraRequestWith<T>(credentials: {
  fetch: PluginContext['fetch']
  instanceUrl: string
  email: string
  apiToken: string
}, path: string, init: RequestInit = {}): Promise<T> {
  if (!credentials.instanceUrl || !credentials.email || !credentials.apiToken) throw new Error('Add your Jira site URL, email, and API token in Jira settings.')
  const response = await credentials.fetch(`${credentials.instanceUrl}${path}`, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Basic ${btoa(`${credentials.email}:${credentials.apiToken}`)}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  })
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`Jira API ${response.status}: ${detail || response.statusText}`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

async function jiraRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!jiraFetch) throw new Error('Add your Jira site URL, email, and API token in Jira settings.')
  return jiraRequestWith({ fetch: jiraFetch, instanceUrl: jiraBaseUrl, email: jiraEmail, apiToken: jiraApiToken }, path, init)
}

export interface JiraProject {
  key: string
  name: string
}

export async function listProjects(): Promise<JiraProject[]> {
  const result = await jiraRequest<{ values: JiraProject[] }>('/rest/api/3/project/search?maxResults=100')
  return result.values
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
      statusCategory?: { name: string; key?: string }
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

export async function testConnection(): Promise<{ displayName: string }> {
  return jiraRequest<{ displayName: string }>('/rest/api/3/myself')
}

export async function testConnectionWith(credentials: {
  fetch: PluginContext['fetch']
  instanceUrl: string
  email: string
  apiToken: string
}): Promise<{ displayName: string }> {
  return jiraRequestWith<{ displayName: string }>(credentials, '/rest/api/3/myself')
}

export async function checkConnection(): Promise<boolean> {
  try {
    await testConnection()
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
    case 'QA Review':
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
  const description = typeof rawDesc === 'string' ? rawDesc : adfToMarkdown(rawDesc).trim()
  const assignee = raw.fields?.assignee?.displayName ?? raw.assignee?.displayName
  const reporter = raw.fields?.reporter?.displayName
  const priority = raw.fields?.priority?.name
  const storyPoints = raw.fields?.story_points ?? raw.fields?.customfield_10016
  const issueType = raw.fields?.issuetype?.name ?? raw.fields?.issueType?.name ?? raw.issuetype?.name
  const parentRef = raw.fields?.parent?.key

  // Body shows only rich-text (ADF) custom fields like Acceptance Criteria. Scalar
  // fields (story points, epic link, rank, sprint…) are noise here — the useful ones
  // already render in the sidebar/breadcrumb as first-class WorkItem fields.
  const customFields: Record<string, string> = {}
  if (raw.fields) {
    for (const [key, value] of Object.entries(raw.fields)) {
      if (!key.startsWith('customfield_')) continue
      if (value == null) continue
      if (!isAdfDoc(value)) continue
      const name = fieldMeta?.get(key) ?? key
      if (CUSTOM_FIELD_DENYLIST.has(name)) continue
      const md = adfToMarkdown(value).trim()
      if (md) customFields[name] = md
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
    statusCategory: mapStatusCategory(raw.fields?.status?.statusCategory?.key),
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
  const fields: Record<string, unknown> = {
    project: { key: projectKey }, summary: params.summary,
    issuetype: { name: params.issueType ?? 'Task' },
  }
  if (params.description) fields.description = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: params.description }] }] }
  if (params.priority) fields.priority = { name: params.priority }
  const created = await jiraRequest<{ key: string }>('/rest/api/3/issue', { method: 'POST', body: JSON.stringify({ fields }) })
  return (await getIssue(created.key)) ?? { key: created.key, fields: { summary: params.summary } }
}

const LIST_PAGE_SIZE = 100
const LIST_MAX_ITEMS = 500

export async function listIssues(
  projectKey?: string,
  { excludeDone = true, maxItems = LIST_MAX_ITEMS }: { excludeDone?: boolean; maxItems?: number } = {},
): Promise<RawJiraIssue[]> {
  const all: RawJiraIssue[] = []
  let nextPageToken: string | undefined

  while (true) {
    const limit = Math.min(LIST_PAGE_SIZE, maxItems - all.length)
    if (limit <= 0) break
    const clauses = [projectKey ? `project = "${projectKey.replace(/["\\]/g, '')}"` : '', excludeDone ? 'statusCategory != Done' : ''].filter(Boolean)
    const result = await jiraRequest<{ issues: RawJiraIssue[]; nextPageToken?: string; isLast?: boolean }>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql: clauses.join(' AND '),
        maxResults: limit,
        fields: ['*all'],
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    })
    const page = result.issues
    all.push(...page)
    nextPageToken = result.nextPageToken
    if (result.isLast === true || !nextPageToken || page.length === 0) break
  }

  return all
}

interface AdfMark {
  type: string
  attrs?: Record<string, unknown>
}

function applyMarks(text: string, marks: AdfMark[] | undefined): string {
  if (!marks?.length) return text
  let out = text
  for (const m of marks) {
    switch (m.type) {
      case 'code':   out = '`' + out + '`'; break
      case 'strong': out = '**' + out + '**'; break
      case 'em':     out = '*' + out + '*'; break
      case 'strike': out = '~~' + out + '~~'; break
      case 'link': {
        const href = m.attrs?.href as string | undefined
        if (href) out = `[${out}](${href})`
        break
      }
    }
  }
  return out
}

function adfChildren(n: Record<string, unknown>): unknown[] {
  return Array.isArray(n.content) ? (n.content as unknown[]) : []
}

function adfList(node: Record<string, unknown>, ordered: boolean, depth: number): string {
  const indent = '  '.repeat(depth)
  let out = ''
  adfChildren(node).forEach((li, idx) => {
    const liNode = li as Record<string, unknown>
    const marker = ordered ? `${idx + 1}. ` : '- '
    const inline: string[] = []
    let nested = ''
    for (const child of adfChildren(liNode)) {
      const c = child as Record<string, unknown>
      if (c.type === 'bulletList') nested += adfList(c, false, depth + 1)
      else if (c.type === 'orderedList') nested += adfList(c, true, depth + 1)
      else inline.push(adfToMarkdown(c, depth).trim())
    }
    out += indent + marker + inline.filter(Boolean).join(' ') + '\n'
    if (nested) out += nested
  })
  return out
}

// ADF (Atlassian Document Format) → Markdown. Preserves headings, lists (nested),
// links, inline code/marks, code blocks — rendered downstream by @comark/vue.
function adfToMarkdown(node: unknown, depth = 0): string {
  if (typeof node === 'string') return node
  if (typeof node !== 'object' || node === null) return ''
  const n = node as Record<string, unknown>
  const kids = () => adfChildren(n).map((c) => adfToMarkdown(c, depth)).join('')

  switch (n.type) {
    case 'text':      return applyMarks(typeof n.text === 'string' ? n.text : '', n.marks as AdfMark[] | undefined)
    case 'hardBreak': return '\n'
    case 'paragraph': return kids() + '\n\n'
    case 'heading': {
      const level = Math.min(Math.max(Number((n.attrs as { level?: number })?.level ?? 1), 1), 6)
      return '#'.repeat(level) + ' ' + kids() + '\n\n'
    }
    case 'bulletList':  return adfList(n, false, depth) + (depth === 0 ? '\n' : '')
    case 'orderedList': return adfList(n, true, depth) + (depth === 0 ? '\n' : '')
    case 'codeBlock': {
      const lang = (n.attrs as { language?: string })?.language ?? ''
      return '```' + lang + '\n' + kids().replace(/\n+$/, '') + '\n```\n\n'
    }
    case 'blockquote':
      return adfChildren(n).map((c) => adfToMarkdown(c, depth)).join('').trimEnd().split('\n').map((l) => '> ' + l).join('\n') + '\n\n'
    case 'rule':        return '---\n\n'
    case 'inlineCard':
    case 'blockCard': {
      const url = (n.attrs as { url?: string })?.url
      return url ? `[${url}](${url})` : ''
    }
    case 'emoji':       return (n.attrs as { text?: string; shortName?: string })?.text ?? (n.attrs as { shortName?: string })?.shortName ?? ''
    case 'mediaSingle':
    case 'mediaGroup':
    case 'media':       return ''
    default:            return kids()
  }
}

// Noise custom fields that should never surface in the body — internal sort keys,
// dev-panel JSON, and scalars already shown elsewhere (sidebar / breadcrumb).
const CUSTOM_FIELD_DENYLIST = new Set([
  'Rank', 'Development', 'Sprint', 'Story Points', 'Story point estimate',
  'Epic Link', 'Parent Link', 'Flagged',
])

function isAdfDoc(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: string }).type === 'doc'
  )
}

let fieldMetaCache: Map<string, string> | null = null

export async function getFieldMeta(): Promise<Map<string, string>> {
  if (!fieldMetaCache) {
    const fields = await jiraRequest<Array<{ id: string; name: string }>>('/rest/api/3/field')
    fieldMetaCache = new Map(fields.map(field => [field.id, field.name]))
  }
  return fieldMetaCache
}

// True board total via Jira Cloud's approximate-count endpoint — the CLI list output
// carries no total, so this is the only cheap way to count without fetching every page.
// Returns null when auth is unavailable or the request fails (callers fall back to the
// loaded/capped count).
export async function countIssues(
  projectKey?: string,
  options: { excludeDone?: boolean } = {},
): Promise<number | null> {
  const clauses = [projectKey ? `project = "${projectKey.replace(/["\\]/g, '')}"` : '', options.excludeDone === false ? '' : 'statusCategory != Done'].filter(Boolean)
  try {
    const result = await jiraRequest<{ count: number }>('/rest/api/3/search/approximate-count', { method: 'POST', body: JSON.stringify({ jql: clauses.join(' AND ') }) })
    return result.count
  } catch { return null }
}

export async function getIssue(id: string): Promise<RawJiraIssue | undefined> {
  try {
    return await jiraRequest<RawJiraIssue>(`/rest/api/3/issue/${encodeURIComponent(id)}?fields=*all`)
  } catch {
    return undefined
  }
}

// REST returns each transition's target status (`to.name`), which the CLI probe does NOT —
// the probe only lists transition NAMES (e.g. "Stop work"), which mapStatus can't resolve,
// collapsing every option to 'open'. Prefer REST; fall back to the probe when auth is absent.
type JiraTransition = IssueTransition & { id: string }

export async function getIssueTransitions(id: string): Promise<JiraTransition[]> {
  const result = await jiraRequest<{ transitions: Array<{ id: string; name: string; to: { name: string; statusCategory?: { name?: string } } }> }>(`/rest/api/3/issue/${encodeURIComponent(id)}/transitions`)
  return result.transitions.map(transition => ({ id: transition.id, name: transition.name, toStatus: mapStatus(transition.to), toStatusLabel: transition.to.name }))
}

export async function transitionIssue(id: string, name: string): Promise<void> {
  const transitions = await getIssueTransitions(id)
  const transition = transitions.find(candidate => candidate.name === name)
  if (!transition?.id) throw new Error(`Jira transition not available: ${name}`)
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(id)}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: transition.id } }) })
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
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(id)}/comment`, { method: 'POST', body: JSON.stringify({ body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] } }) })
}
