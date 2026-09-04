import DOMPurify from 'dompurify'
import { marked } from 'marked'

type PluginApi = { getRoute(): string; invoke<T>(command: string, args?: unknown): Promise<T>; navigate(path: string): void; openExternal(url: string): void; startSession(itemId: string, projectPath?: string): void; getWorkItemSessions(itemId?: string): Promise<WorkItemSession[]>; openSession(sessionId: string): void; onRouteChanged(listener: (path: string) => void): () => void }
type WorkItem = { id: string; externalRef: string; title: string; body: string; status: string; statusLabel?: string; assignee?: string; reporter?: string; priority?: string; issueType?: string; storyPoints?: number; parentRef?: string; customFields?: Record<string, string> }
type JiraProject = { key: string; name: string }
type JiraSettingsData = { projects: JiraProject[]; projectError: string; agentProjects: Array<{ path: string; name: string }>; selectedKeys: string[]; projectMappings: Array<{ jiraProjectKey: string; projectPath: string }>; cliPath: string; apiTokenSource: 'keychain' | 'environment' | 'none' }
type WorkItemSession = { id: string; itemId: string; status: string; title?: string | null; lastActivityAt: number }
type IssueTransition = { name: string; toStatus: string; toStatusLabel: string }
declare global { interface Window { agentkeeperPlugin: PluginApi } }

const api = window.agentkeeperPlugin
const root = document.querySelector<HTMLDivElement>('#app')!
let selectedProjects = new Set<string>()
let searchQuery = ''
let scopeFilter: 'all' | 'assigned' | 'has-session' | 'high-priority' = 'all'
let groupBy: 'flat' | 'status' | 'priority' | 'type' | 'assignee' = 'flat'

const style = document.createElement('style')
style.textContent = `
  :root{color-scheme:light dark}*{box-sizing:border-box}body{overflow:hidden}.layout{height:100%;display:flex;background:inherit;color:inherit}
  .sidebar{width:220px;flex:none;border-right:1px solid rgba(127,127,127,.25);padding:16px 10px;overflow:auto}.sidebar-title,.eyebrow,.column{font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;opacity:.55}
  .project{width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:7px;padding:7px 8px;background:transparent;color:inherit;text-align:left;cursor:pointer}.project:hover{background:rgba(127,127,127,.1)}.project.active{background:rgba(59,130,246,.13);color:#3b82f6}
  .check{width:14px;height:14px;border:1px solid rgba(127,127,127,.5);border-radius:3px;display:grid;place-items:center;font-size:10px}.active .check{background:#3b82f6;border-color:#3b82f6;color:white}.project-key{font:12px ui-monospace,monospace}.count{margin-left:auto;font-size:11px;opacity:.55}
  .main{flex:1;min-width:0;display:flex;flex-direction:column}.toolbar{display:flex;align-items:end;justify-content:space-between;gap:14px;padding:18px 22px 13px;border-bottom:1px solid rgba(127,127,127,.22)}.toolbar-actions,.detail-actions,.form-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}h1{font-size:20px;margin:3px 0 0}.search,.select,.field{border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:Canvas;color:CanvasText;outline:none}.search{width:200px}.search:focus,.field:focus{border-color:#3b82f6}
  .table{flex:1;min-height:0;overflow:auto}.header,.row{display:grid;grid-template-columns:96px minmax(240px,1fr) 120px 100px 70px 140px;align-items:center;column-gap:12px;padding:0 18px}.header{height:34px;position:sticky;top:0;z-index:1;background:Canvas;border-bottom:1px solid rgba(127,127,127,.22)}.row{min-height:54px;border-bottom:1px solid rgba(127,127,127,.16);cursor:pointer}.row:hover{background:rgba(127,127,127,.07)}.group-heading{padding:12px 18px 7px;background:rgba(127,127,127,.08);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em}.session-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#22c55e;margin-left:6px}
  .key{font:12px ui-monospace,monospace;opacity:.65}.issue-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subtitle{font-size:11px;opacity:.55;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{display:inline-flex;width:max-content;padding:2px 7px;border-radius:999px;font-size:11px;background:rgba(59,130,246,.14);color:#3b82f6}.priority{font-size:11px;text-transform:capitalize}.muted{opacity:.55}.empty,.loading{padding:40px;text-align:center;opacity:.6}.error{margin:24px;padding:14px;border:1px solid #ef4444;border-radius:8px;color:#ef4444}
  .detail{height:100%;overflow:auto;padding:24px;max-width:1000px;margin:auto}.detail-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.detail h1{font-size:22px}.meta{display:flex;gap:10px;align-items:center;margin:12px 0}.panel{border:1px solid rgba(127,127,127,.25);border-radius:9px;padding:14px;margin-top:18px}.transition-list{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px}button{font:inherit}
  .settings{height:100%;overflow:auto;padding:28px;max-width:900px}.settings-copy{line-height:1.5;margin:7px 0 22px;opacity:.65}.settings-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px}.settings-bar .search{flex:1;width:auto}.save{border:0;border-radius:7px;padding:8px 14px;background:#3b82f6;color:white;cursor:pointer}.save:disabled{opacity:.55;cursor:default}.secondary{border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:transparent;color:inherit;cursor:pointer}.project-list{border:1px solid rgba(127,127,127,.25);border-radius:9px;overflow:hidden}.project-option{display:flex;align-items:center;gap:12px;padding:11px 13px;border-bottom:1px solid rgba(127,127,127,.16);cursor:pointer}.project-option:last-child{border-bottom:0}.project-option:hover{background:rgba(127,127,127,.07)}.project-name{font-size:13px;font-weight:600}.project-description{font-size:11px;opacity:.55;margin-top:2px}.selection-summary{font-size:12px;opacity:.65;margin-right:auto}.notice{font-size:12px;color:#16a34a}.overlay{position:fixed;inset:0;z-index:10;display:grid;place-items:center;background:rgba(0,0,0,.45);padding:20px}.modal{width:min(500px,100%);max-height:90vh;overflow:auto;border:1px solid rgba(127,127,127,.3);border-radius:11px;background:Canvas;padding:20px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.field{width:100%;margin-top:5px}.markdown-body{line-height:1.6;overflow-wrap:anywhere}.markdown-body h1,.markdown-body h2,.markdown-body h3{line-height:1.25;margin:20px 0 10px}.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body pre{margin:0 0 14px}.markdown-body code{font:12px ui-monospace,monospace;padding:.18em .38em;border-radius:5px;background:rgba(127,127,127,.16)}.markdown-body pre{padding:14px;border-radius:8px;background:rgba(127,127,127,.1);overflow:auto}.markdown-body pre code{padding:0;background:transparent}.markdown-body a{color:#58a6ff}
  @media(max-width:850px){.sidebar{width:175px}.header,.row{grid-template-columns:86px minmax(200px,1fr) 105px 90px}.points,.assignee{display:none}}
`
document.head.append(style)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function projectOf(item: WorkItem): string { return item.externalRef.match(/^[A-Z][A-Z0-9_]*/)?.[0] ?? '' }
function showError(): void { root.replaceChildren(el('div', 'error', 'Provider not available')) }
function markdownBody(markdown: string): HTMLDivElement { const body = el('div', 'markdown-body'); body.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }) as string, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'], FORBID_ATTR: ['style'] }); for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) { try { const url = new URL(link.href); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); link.addEventListener('click', event => { event.preventDefault(); api.openExternal(url.href) }) } catch { link.removeAttribute('href') } }; return body }

function projectButton(project: JiraProject, count: number, redraw: () => void): HTMLButtonElement {
  const active = selectedProjects.has(project.key)
  const button = el('button', `project${active ? ' active' : ''}`)
  button.append(el('span', 'check', active ? '✓' : ''), el('span', 'project-key', project.key), el('span', 'count', String(count)))
  button.title = project.name
  button.addEventListener('click', () => { const next = new Set(selectedProjects); next.has(project.key) ? next.delete(project.key) : next.add(project.key); selectedProjects = next; redraw() })
  return button
}

async function renderBoard(): Promise<void> {
  root.replaceChildren(el('div', 'loading', 'Loading Jira issues…'))
  try {
    const [items, available, sessions] = await Promise.all([api.invoke<WorkItem[]>('jira.workItems.list'), api.invoke<JiraProject[]>('jira.projects.list').catch(() => []), api.getWorkItemSessions().catch(() => [])])
    const itemKeys = new Set(items.map(projectOf).filter(Boolean))
    const projects = available.filter((project) => itemKeys.size === 0 || itemKeys.has(project.key))
    for (const key of itemKeys) if (!projects.some((project) => project.key === key)) projects.push({ key, name: key })
    projects.sort((a, b) => a.key.localeCompare(b.key))
    const loadedCounts = Object.fromEntries(projects.map((project) => [project.key, items.filter((item) => projectOf(item) === project.key).length]))
    const counts = await api.invoke<Record<string, number>>('jira.boards.count', { keys: projects.map((project) => project.key) }).catch(() => loadedCounts)
    draw(items, projects, { ...loadedCounts, ...counts }, sessions)
  } catch { showError() }
}

function draw(items: WorkItem[], projects: JiraProject[], counts: Record<string, number>, sessions: WorkItemSession[]): void {
  const filtered = items.filter((item) => {
    if (selectedProjects.size && !selectedProjects.has(projectOf(item))) return false
    if (scopeFilter === 'assigned' && !item.assignee) return false
    if (scopeFilter === 'has-session' && !sessions.some(session => session.itemId === item.id)) return false
    if (scopeFilter === 'high-priority' && !['highest', 'high'].includes(item.priority?.toLowerCase() ?? '')) return false
    const query = searchQuery.trim().toLowerCase()
    return !query || item.title.toLowerCase().includes(query) || item.externalRef.toLowerCase().includes(query)
  })
  const redraw = () => draw(items, projects, counts, sessions)
  const layout = el('div', 'layout')
  const sidebar = el('aside', 'sidebar'); sidebar.append(el('div', 'sidebar-title', 'Projects'))
  const all = el('button', `project${selectedProjects.size === 0 ? ' active' : ''}`); all.append(el('span', 'check', selectedProjects.size === 0 ? '✓' : ''), el('span', 'project-key', 'All projects'), el('span', 'count', String(items.length))); all.addEventListener('click', () => { selectedProjects = new Set(); redraw() }); sidebar.append(all)
  for (const project of projects) sidebar.append(projectButton(project, counts[project.key] ?? 0, redraw))

  const main = el('main', 'main'), toolbar = el('div', 'toolbar'), heading = el('div'), toolbarActions = el('div', 'toolbar-actions')
  heading.append(el('div', 'eyebrow', `${filtered.length} of ${items.length} issues · ${filtered.reduce((sum, item) => sum + (item.storyPoints ?? 0), 0)} points`), el('h1', '', 'Issues'))
  const search = el('input', 'search'); search.type = 'search'; search.placeholder = 'Search issues'; search.value = searchQuery
  search.addEventListener('input', () => { searchQuery = search.value; redraw(); const next = document.querySelector<HTMLInputElement>('.search'); next?.focus(); next?.setSelectionRange(searchQuery.length, searchQuery.length) })
  const scope = el('select', 'select'); for (const [value, label] of [['all', 'All issues'], ['assigned', 'Assigned'], ['has-session', 'Has session'], ['high-priority', 'High priority']]) { const option = el('option', '', label); option.value = value; option.selected = value === scopeFilter; scope.append(option) }; scope.addEventListener('change', () => { scopeFilter = scope.value as typeof scopeFilter; redraw() })
  const grouping = el('select', 'select'); for (const [value, label] of [['flat', 'No grouping'], ['status', 'Group by status'], ['priority', 'Group by priority'], ['type', 'Group by type'], ['assignee', 'Group by assignee']]) { const option = el('option', '', label); option.value = value; option.selected = value === groupBy; grouping.append(option) }; grouping.addEventListener('change', () => { groupBy = grouping.value as typeof groupBy; redraw() })
  const create = el('button', 'save', 'Create ticket'); create.addEventListener('click', () => showCreateTicket(projects, () => { void renderBoard() }))
  toolbarActions.append(scope, grouping, search, create); toolbar.append(heading, toolbarActions); main.append(toolbar)

  const table = el('div', 'table'), header = el('div', 'header')
  for (const [label, cls] of [['Key', ''], ['Title', ''], ['Status', ''], ['Priority', ''], ['Points', 'points'], ['Assignee', 'assignee']]) header.append(el('div', `column ${cls}`, label))
  table.append(header)
  if (!filtered.length) table.append(el('div', 'empty', 'No issues match these filters.'))
  const grouped = new Map<string, WorkItem[]>()
  for (const item of filtered) { const key = groupBy === 'flat' ? '' : groupBy === 'status' ? (item.statusLabel ?? item.status) : groupBy === 'priority' ? (item.priority ?? 'No priority') : groupBy === 'type' ? (item.issueType ?? 'No type') : (item.assignee ?? 'Unassigned'); const group = grouped.get(key) ?? []; group.push(item); grouped.set(key, group) }
  for (const [group, groupItems] of grouped) {
    if (groupBy !== 'flat') table.append(el('div', 'group-heading', `${group} · ${groupItems.length}`))
    for (const item of groupItems) {
    const row = el('div', 'row'), title = el('div')
    const issueTitle = el('div', 'issue-title', item.title); if (sessions.some(session => session.itemId === item.id)) { const dot = el('span', 'session-dot'); dot.title = 'Has AgentKeeper session'; issueTitle.append(dot) }; title.append(issueTitle, el('div', 'subtitle', [item.issueType, item.parentRef].filter(Boolean).join(' · ') || projectOf(item)))
    row.append(el('div', 'key', item.externalRef), title, el('span', 'badge', item.statusLabel ?? item.status.replaceAll('_', ' ')), el('div', 'priority', item.priority ?? '—'), el('div', 'points', item.storyPoints == null ? '—' : String(item.storyPoints)), el('div', 'assignee', item.assignee ?? 'Unassigned'))
    row.tabIndex = 0; const open = () => api.navigate(`work-items/${encodeURIComponent(item.id)}`); row.addEventListener('click', open); row.addEventListener('keydown', (event) => { if (event.key === 'Enter') open() }); table.append(row)
    }
  }
  main.append(table); layout.append(sidebar, main); root.replaceChildren(layout)
}

function showCreateTicket(projects: JiraProject[], created: () => void): void {
  const overlay = el('div', 'overlay'), modal = el('form', 'modal'), title = el('h1', '', 'Create Jira ticket')
  const project = el('select', 'field'); for (const candidate of projects) { const option = el('option', '', `${candidate.key} — ${candidate.name}`); option.value = candidate.key; project.append(option) }
  const summary = el('input', 'field'); summary.required = true; summary.placeholder = 'Brief issue summary'
  const type = el('select', 'field'); for (const value of ['Task', 'Story', 'Bug', 'Sub-task']) { const option = el('option', '', value); option.value = value; type.append(option) }
  const priority = el('select', 'field'); for (const value of ['', 'Highest', 'High', 'Medium', 'Low', 'Lowest']) { const option = el('option', '', value || 'No priority'); option.value = value; priority.append(option) }
  const description = el('textarea', 'field'); description.rows = 5; description.placeholder = 'Description (optional)'
  const grid = el('div', 'form-grid'), projectLabel = el('label', '', 'Project'), typeLabel = el('label', '', 'Issue type'), priorityLabel = el('label', '', 'Priority'); projectLabel.append(project); typeLabel.append(type); priorityLabel.append(priority); grid.append(projectLabel, typeLabel, priorityLabel)
  const summaryLabel = el('label', '', 'Summary'); summaryLabel.append(summary); const descriptionLabel = el('label', '', 'Description'); descriptionLabel.append(description)
  const actions = el('div', 'form-actions'), status = el('span', 'meta'), cancel = el('button', 'secondary', 'Cancel'), submit = el('button', 'save', 'Create')
  cancel.type = 'button'; cancel.addEventListener('click', () => overlay.remove())
  modal.addEventListener('submit', async event => { event.preventDefault(); if (!project.value || !summary.value.trim()) return; submit.disabled = true; status.textContent = 'Creating…'; try { await api.invoke('jira.workItems.create', { projectKey: project.value, summary: summary.value, issueType: type.value, priority: priority.value, description: description.value }); overlay.remove(); created() } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); submit.disabled = false } })
  actions.append(status, cancel, submit); modal.append(title, grid, summaryLabel, descriptionLabel, actions); overlay.append(modal); document.body.append(overlay); summary.focus()
}

async function renderItem(itemId: string): Promise<void> {
  root.replaceChildren(el('div', 'loading', 'Loading work item…'))
  try {
    const [item, transitions, sessions, settings] = await Promise.all([api.invoke<WorkItem | undefined>('jira.workItems.get', { itemId }), api.invoke<IssueTransition[]>('jira.workItems.getTransitions', { itemId }).catch(() => []), api.getWorkItemSessions(itemId).catch(() => []), api.invoke<JiraSettingsData>('jira.settings.get').catch(() => null)]); if (!item) throw new Error('not found')
    const suggestedProject = settings?.projectMappings.find(mapping => mapping.jiraProjectKey === projectOf(item))?.projectPath
    const detail = el('main', 'detail'), header = el('div', 'detail-header'), back = el('button', 'secondary', '← Issues'), actions = el('div', 'detail-actions'), start = el('button', 'save', 'Start session'); back.addEventListener('click', () => api.navigate('board')); start.addEventListener('click', () => api.startSession(item.id, suggestedProject)); actions.append(start)
    for (const session of sessions) { const open = el('button', 'secondary', session.status === 'running' ? 'Open active session' : 'Open session'); open.addEventListener('click', () => api.openSession(session.id)); actions.append(open) }
    header.append(back, actions); detail.append(header, el('div', 'key', item.externalRef), el('h1', '', item.title)); const meta = el('div', 'meta'); meta.append(el('span', 'badge', item.statusLabel ?? item.status), el('span', 'priority', item.priority ?? 'No priority'), el('span', 'muted', item.assignee ?? 'Unassigned')); if (item.issueType) meta.append(el('span', 'muted', item.issueType)); if (item.storyPoints != null) meta.append(el('span', 'muted', `${item.storyPoints} points`)); if (item.parentRef) meta.append(el('span', 'key', `Parent ${item.parentRef}`)); detail.append(meta)
    const description = el('section', 'panel'); description.append(el('div', 'eyebrow', 'Description'), markdownBody(item.body || '*No description.*')); detail.append(description)
    for (const [name, value] of Object.entries(item.customFields ?? {})) { const field = el('section', 'panel'); field.append(el('div', 'eyebrow', name), markdownBody(value)); detail.append(field) }
    const transitionPanel = el('section', 'panel'); transitionPanel.append(el('div', 'eyebrow', 'Status transitions')); const transitionList = el('div', 'transition-list'); if (!transitions.length) transitionList.append(el('span', 'muted', 'No transitions available.')); for (const transition of transitions) { const button = el('button', 'secondary', transition.toStatusLabel); button.title = transition.name; button.addEventListener('click', async () => { button.disabled = true; button.textContent = 'Moving…'; try { await api.invoke('jira.workItems.transition', { itemId, name: transition.name }); void renderItem(itemId) } catch { showError() } }); transitionList.append(button) }; transitionPanel.append(transitionList); detail.append(transitionPanel)
    const commentPanel = el('section', 'panel'), comment = el('textarea', 'field'); comment.rows = 4; comment.placeholder = 'Add a comment…'; const commentActions = el('div', 'form-actions'), commentStatus = el('span', 'meta'), submit = el('button', 'save', 'Comment'); submit.addEventListener('click', async () => { if (!comment.value.trim()) return; submit.disabled = true; commentStatus.textContent = 'Posting…'; try { await api.invoke('jira.workItems.addComment', { itemId, body: comment.value }); comment.value = ''; commentStatus.textContent = 'Comment posted.' } catch (error) { commentStatus.textContent = error instanceof Error ? error.message : String(error) } finally { submit.disabled = false } }); commentActions.append(commentStatus, submit); commentPanel.append(el('div', 'eyebrow', 'Comment'), comment, commentActions); detail.append(commentPanel); root.replaceChildren(detail)
  } catch { showError() }
}

async function renderSettings(): Promise<void> {
  root.replaceChildren(el('div', 'loading', 'Loading Jira projects…'))
  try {
    const data = await api.invoke<JiraSettingsData>('jira.settings.get')
    let draft = new Set(data.selectedKeys)
    const draftMappings = new Map(data.projectMappings.map(mapping => [mapping.jiraProjectKey, mapping.projectPath]))
    let filter = ''
    let cliPath = data.cliPath
    let apiToken = ''
    let saving = false

    const drawSettings = (message = '') => {
      const page = el('main', 'settings')
      page.append(el('div', 'eyebrow', 'Plugin settings'), el('h1', '', 'Jira projects'), el('p', 'settings-copy', `Jira has ${data.projects.length} projects available. Select the projects AgentKeeper should import and display.`))
      const bar = el('div', 'settings-bar'), search = el('input', 'search'), summary = el('span', 'selection-summary', `${draft.size} of ${data.projects.length} selected`), save = el('button', 'save', saving ? 'Saving…' : 'Save selection')
      search.type = 'search'; search.placeholder = 'Search projects'; search.value = filter
      search.addEventListener('input', () => { filter = search.value; drawSettings(); const next = document.querySelector<HTMLInputElement>('.settings .search'); next?.focus(); next?.setSelectionRange(filter.length, filter.length) })
      save.disabled = saving
      save.addEventListener('click', async () => {
        saving = true; drawSettings()
        try { await api.invoke('jira.settings.selectProjects', { keys: [...draft], cliPath, apiToken, projectMappings: [...draftMappings].filter(([key, path]) => draft.has(key) && path).map(([jiraProjectKey, projectPath]) => ({ jiraProjectKey, projectPath })) }); saving = false; apiToken = ''; drawSettings('Plugin settings saved. Reload this page to refresh Jira projects.') }
        catch (error) { saving = false; drawSettings(error instanceof Error ? error.message : String(error)) }
      })
      bar.append(summary, search, save); page.append(bar)
      const cliLabel = el('label', 'settings-copy', 'Jira CLI path'), cliInput = el('input', 'field'); cliInput.placeholder = 'jira (use PATH)'; cliInput.value = cliPath; cliInput.addEventListener('input', () => { cliPath = cliInput.value }); cliLabel.append(cliInput); page.append(cliLabel)
      const tokenLabel = el('label', 'settings-copy', 'Jira API token'), tokenInput = el('input', 'field'); tokenInput.type = 'password'; tokenInput.autocomplete = 'off'; tokenInput.placeholder = data.apiTokenSource === 'keychain' ? 'Using token stored in OS keychain' : data.apiTokenSource === 'environment' ? 'Using JIRA_API_TOKEN from host environment' : 'Required by Jira CLI'; tokenInput.value = apiToken; tokenInput.addEventListener('input', () => { apiToken = tokenInput.value }); tokenLabel.append(tokenInput); page.append(tokenLabel)
      if (data.projectError) page.append(el('p', 'error', data.projectError))
      if (message) page.append(el('p', 'notice', message))
      const list = el('div', 'project-list')
      const visible = data.projects.filter(project => `${project.key} ${project.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
      if (!visible.length) list.append(el('div', 'empty', 'No projects match your search.'))
      for (const project of visible) {
        const label = el('label', 'project-option'), checkbox = el('input')
        checkbox.type = 'checkbox'; checkbox.checked = draft.has(project.key)
        checkbox.addEventListener('change', () => { const next = new Set(draft); checkbox.checked ? next.add(project.key) : next.delete(project.key); draft = next; drawSettings() })
        const text = el('div'); text.style.flex = '1'; text.append(el('div', 'project-name', project.name), el('div', 'project-description', project.key))
        const mapping = el('select', 'select'); const none = el('option', '', 'No AgentKeeper project'); none.value = ''; mapping.append(none); for (const agentProject of data.agentProjects) { const option = el('option', '', agentProject.name); option.value = agentProject.path; option.selected = draftMappings.get(project.key) === agentProject.path; mapping.append(option) }; mapping.addEventListener('click', event => event.stopPropagation()); mapping.addEventListener('change', () => { if (mapping.value) draftMappings.set(project.key, mapping.value); else draftMappings.delete(project.key) })
        label.append(checkbox, text, mapping); list.append(label)
      }
      page.append(list); root.replaceChildren(page)
    }
    drawSettings()
  } catch { showError() }
}

function render(path: string): void { const match = /^work-items\/(.+)$/.exec(path); if (match) void renderItem(decodeURIComponent(match[1]!)); else if (path === 'settings') void renderSettings(); else void renderBoard() }
render(api.getRoute()); api.onRouteChanged(render)
export {}
