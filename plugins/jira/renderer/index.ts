type PluginApi = { getRoute(): string; invoke<T>(command: string, args?: unknown): Promise<T>; navigate(path: string): void; startSession(itemId: string, projectPath?: string): void; onRouteChanged(listener: (path: string) => void): () => void }
type WorkItem = { id: string; externalRef: string; title: string; body: string; status: string; statusLabel?: string; assignee?: string; priority?: string; issueType?: string; storyPoints?: number; parentRef?: string }
type JiraProject = { key: string; name: string }
declare global { interface Window { agentkeeperPlugin: PluginApi } }

const api = window.agentkeeperPlugin
const root = document.querySelector<HTMLDivElement>('#app')!
let selectedProjects = new Set<string>()
let searchQuery = ''

const style = document.createElement('style')
style.textContent = `
  :root{color-scheme:light dark}*{box-sizing:border-box}body{overflow:hidden}.layout{height:100%;display:flex;background:inherit;color:inherit}
  .sidebar{width:220px;flex:none;border-right:1px solid rgba(127,127,127,.25);padding:16px 10px;overflow:auto}.sidebar-title,.eyebrow,.column{font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;opacity:.55}
  .project{width:100%;display:flex;align-items:center;gap:9px;border:0;border-radius:7px;padding:7px 8px;background:transparent;color:inherit;text-align:left;cursor:pointer}.project:hover{background:rgba(127,127,127,.1)}.project.active{background:rgba(59,130,246,.13);color:#3b82f6}
  .check{width:14px;height:14px;border:1px solid rgba(127,127,127,.5);border-radius:3px;display:grid;place-items:center;font-size:10px}.active .check{background:#3b82f6;border-color:#3b82f6;color:white}.project-key{font:12px ui-monospace,monospace}.count{margin-left:auto;font-size:11px;opacity:.55}
  .main{flex:1;min-width:0;display:flex;flex-direction:column}.toolbar{display:flex;align-items:end;justify-content:space-between;padding:18px 22px 13px;border-bottom:1px solid rgba(127,127,127,.22)}h1{font-size:20px;margin:3px 0 0}.search{width:220px;border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:transparent;color:inherit;outline:none}.search:focus{border-color:#3b82f6}
  .table{flex:1;min-height:0;overflow:auto}.header,.row{display:grid;grid-template-columns:96px minmax(240px,1fr) 120px 100px 70px 140px;align-items:center;column-gap:12px;padding:0 18px}.header{height:34px;position:sticky;top:0;z-index:1;background:Canvas;border-bottom:1px solid rgba(127,127,127,.22)}.row{min-height:54px;border-bottom:1px solid rgba(127,127,127,.16);cursor:pointer}.row:hover{background:rgba(127,127,127,.07)}
  .key{font:12px ui-monospace,monospace;opacity:.65}.issue-title{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.subtitle{font-size:11px;opacity:.55;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.badge{display:inline-flex;width:max-content;padding:2px 7px;border-radius:999px;font-size:11px;background:rgba(59,130,246,.14);color:#3b82f6}.priority{font-size:11px;text-transform:capitalize}.muted{opacity:.55}.empty,.loading{padding:40px;text-align:center;opacity:.6}.error{margin:24px;padding:14px;border:1px solid #ef4444;border-radius:8px;color:#ef4444}
  .detail{height:100%;overflow:auto;padding:24px;max-width:1000px;margin:auto}.detail-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.detail h1{font-size:22px}.meta{display:flex;gap:10px;align-items:center;margin:12px 0}.body{white-space:pre-wrap;line-height:1.6;margin-top:22px}button{font:inherit}
  .settings{height:100%;overflow:auto;padding:28px;max-width:900px}.settings-copy{line-height:1.5;margin:7px 0 22px;opacity:.65}.settings-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px}.settings-bar .search{flex:1;width:auto}.save{border:0;border-radius:7px;padding:8px 14px;background:#3b82f6;color:white;cursor:pointer}.save:disabled{opacity:.55;cursor:default}.project-list{border:1px solid rgba(127,127,127,.25);border-radius:9px;overflow:hidden}.project-option{display:flex;align-items:center;gap:12px;padding:11px 13px;border-bottom:1px solid rgba(127,127,127,.16);cursor:pointer}.project-option:last-child{border-bottom:0}.project-option:hover{background:rgba(127,127,127,.07)}.project-name{font-size:13px;font-weight:600}.project-description{font-size:11px;opacity:.55;margin-top:2px}.selection-summary{font-size:12px;opacity:.65;margin-right:auto}.notice{font-size:12px;color:#16a34a}
  @media(max-width:850px){.sidebar{width:175px}.header,.row{grid-template-columns:86px minmax(200px,1fr) 105px 90px}.points,.assignee{display:none}}
`
document.head.append(style)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function projectOf(item: WorkItem): string { return item.externalRef.match(/^[A-Z][A-Z0-9_]*/)?.[0] ?? '' }
function showError(): void { root.replaceChildren(el('div', 'error', 'Provider not available')) }

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
    const [items, available] = await Promise.all([api.invoke<WorkItem[]>('jira.workItems.list'), api.invoke<JiraProject[]>('jira.projects.list').catch(() => [])])
    const itemKeys = new Set(items.map(projectOf).filter(Boolean))
    const projects = available.filter((project) => itemKeys.size === 0 || itemKeys.has(project.key))
    for (const key of itemKeys) if (!projects.some((project) => project.key === key)) projects.push({ key, name: key })
    projects.sort((a, b) => a.key.localeCompare(b.key))
    const loadedCounts = Object.fromEntries(projects.map((project) => [project.key, items.filter((item) => projectOf(item) === project.key).length]))
    const counts = await api.invoke<Record<string, number>>('jira.boards.count', { keys: projects.map((project) => project.key) }).catch(() => loadedCounts)
    draw(items, projects, { ...loadedCounts, ...counts })
  } catch { showError() }
}

function draw(items: WorkItem[], projects: JiraProject[], counts: Record<string, number>): void {
  const filtered = items.filter((item) => {
    if (selectedProjects.size && !selectedProjects.has(projectOf(item))) return false
    const query = searchQuery.trim().toLowerCase()
    return !query || item.title.toLowerCase().includes(query) || item.externalRef.toLowerCase().includes(query)
  })
  const redraw = () => draw(items, projects, counts)
  const layout = el('div', 'layout')
  const sidebar = el('aside', 'sidebar'); sidebar.append(el('div', 'sidebar-title', 'Projects'))
  const all = el('button', `project${selectedProjects.size === 0 ? ' active' : ''}`); all.append(el('span', 'check', selectedProjects.size === 0 ? '✓' : ''), el('span', 'project-key', 'All projects'), el('span', 'count', String(items.length))); all.addEventListener('click', () => { selectedProjects = new Set(); redraw() }); sidebar.append(all)
  for (const project of projects) sidebar.append(projectButton(project, counts[project.key] ?? 0, redraw))

  const main = el('main', 'main'), toolbar = el('div', 'toolbar'), heading = el('div')
  heading.append(el('div', 'eyebrow', `${filtered.length} of ${items.length} issues`), el('h1', '', 'Issues'))
  const search = el('input', 'search'); search.type = 'search'; search.placeholder = 'Search issues'; search.value = searchQuery
  search.addEventListener('input', () => { searchQuery = search.value; redraw(); const next = document.querySelector<HTMLInputElement>('.search'); next?.focus(); next?.setSelectionRange(searchQuery.length, searchQuery.length) })
  toolbar.append(heading, search); main.append(toolbar)

  const table = el('div', 'table'), header = el('div', 'header')
  for (const [label, cls] of [['Key', ''], ['Title', ''], ['Status', ''], ['Priority', ''], ['Points', 'points'], ['Assignee', 'assignee']]) header.append(el('div', `column ${cls}`, label))
  table.append(header)
  if (!filtered.length) table.append(el('div', 'empty', 'No issues match these filters.'))
  for (const item of filtered) {
    const row = el('div', 'row'), title = el('div')
    title.append(el('div', 'issue-title', item.title), el('div', 'subtitle', [item.issueType, item.parentRef].filter(Boolean).join(' · ') || projectOf(item)))
    row.append(el('div', 'key', item.externalRef), title, el('span', 'badge', item.statusLabel ?? item.status.replaceAll('_', ' ')), el('div', 'priority', item.priority ?? '—'), el('div', 'points', item.storyPoints == null ? '—' : String(item.storyPoints)), el('div', 'assignee', item.assignee ?? 'Unassigned'))
    row.tabIndex = 0; const open = () => api.navigate(`work-items/${encodeURIComponent(item.id)}`); row.addEventListener('click', open); row.addEventListener('keydown', (event) => { if (event.key === 'Enter') open() }); table.append(row)
  }
  main.append(table); layout.append(sidebar, main); root.replaceChildren(layout)
}

async function renderItem(itemId: string): Promise<void> {
  root.replaceChildren(el('div', 'loading', 'Loading work item…'))
  try {
    const item = await api.invoke<WorkItem | undefined>('jira.workItems.get', { itemId }); if (!item) throw new Error('not found')
    const detail = el('main', 'detail'), header = el('div', 'detail-header'), back = el('button', 'project', '← Issues'), start = el('button', 'save', 'Start session'); back.addEventListener('click', () => api.navigate('board')); start.addEventListener('click', () => api.startSession(item.id)); header.append(back, start)
    detail.append(header, el('div', 'key', item.externalRef), el('h1', '', item.title)); const meta = el('div', 'meta'); meta.append(el('span', 'badge', item.statusLabel ?? item.status), el('span', 'priority', item.priority ?? 'No priority'), el('span', 'muted', item.assignee ?? 'Unassigned')); detail.append(meta, el('div', 'body', item.body || 'No description.')); root.replaceChildren(detail)
  } catch { showError() }
}

async function renderSettings(): Promise<void> {
  root.replaceChildren(el('div', 'loading', 'Loading Jira projects…'))
  try {
    const data = await api.invoke<{ projects: JiraProject[]; selectedKeys: string[] }>('jira.settings.get')
    let draft = new Set(data.selectedKeys)
    let filter = ''
    let saving = false

    const drawSettings = (message = '') => {
      const page = el('main', 'settings')
      page.append(el('div', 'eyebrow', 'Plugin settings'), el('h1', '', 'Jira projects'), el('p', 'settings-copy', `Jira has ${data.projects.length} projects available. Select the projects AgentKeeper should import and display.`))
      const bar = el('div', 'settings-bar'), search = el('input', 'search'), summary = el('span', 'selection-summary', `${draft.size} of ${data.projects.length} selected`), save = el('button', 'save', saving ? 'Saving…' : 'Save selection')
      search.type = 'search'; search.placeholder = 'Search projects'; search.value = filter
      search.addEventListener('input', () => { filter = search.value; drawSettings(); const next = document.querySelector<HTMLInputElement>('.settings .search'); next?.focus(); next?.setSelectionRange(filter.length, filter.length) })
      save.disabled = saving || draft.size === 0
      if (draft.size === 0) save.title = 'Select at least one project'
      save.addEventListener('click', async () => {
        saving = true; drawSettings()
        try { await api.invoke('jira.settings.selectProjects', { keys: [...draft] }); saving = false; drawSettings('Project selection saved.') }
        catch { saving = false; showError() }
      })
      bar.append(summary, search, save); page.append(bar)
      if (message) page.append(el('p', 'notice', message))
      const list = el('div', 'project-list')
      const visible = data.projects.filter(project => `${project.key} ${project.name}`.toLowerCase().includes(filter.trim().toLowerCase()))
      if (!visible.length) list.append(el('div', 'empty', 'No projects match your search.'))
      for (const project of visible) {
        const label = el('label', 'project-option'), checkbox = el('input')
        checkbox.type = 'checkbox'; checkbox.checked = draft.has(project.key)
        checkbox.addEventListener('change', () => { const next = new Set(draft); checkbox.checked ? next.add(project.key) : next.delete(project.key); draft = next; drawSettings() })
        const text = el('div'); text.append(el('div', 'project-name', project.name), el('div', 'project-description', project.key))
        label.append(checkbox, text); list.append(label)
      }
      page.append(list); root.replaceChildren(page)
    }
    drawSettings()
  } catch { showError() }
}

function render(path: string): void { const match = /^work-items\/(.+)$/.exec(path); if (match) void renderItem(decodeURIComponent(match[1]!)); else if (path === 'settings') void renderSettings(); else void renderBoard() }
render(api.getRoute()); api.onRouteChanged(render)
export {}
