type PluginApi = {
  getRoute(): string
  invoke<T>(command: string, args?: unknown): Promise<T>
  navigate(path: string): void
  openExternal(url: string): void
  onRouteChanged(listener: (path: string) => void): () => void
}

type PullRequest = {
  number: number
  title: string
  state: string
  author: string
  url: string
  isDraft: boolean
  headRef: string
  baseRef: string
  updatedAt: string
  additions?: number
  deletions?: number
  changedFiles?: number
  body?: string
}

type WorkItem = { id: string; externalRef: string; title: string; body: string; statusLabel?: string; status: string }

declare global { interface Window { agentkeeperPlugin: PluginApi } }
const api = window.agentkeeperPlugin
const root = document.querySelector<HTMLDivElement>('#app')!

const style = document.createElement('style')
style.textContent = `
  .shell{min-height:100%;padding:24px;max-width:1200px;margin:auto}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}h1{font-size:20px;margin:0}.muted{opacity:.65}
  .list{display:flex;flex-direction:column;gap:9px}.card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:14px;background:rgba(127,127,127,.05);cursor:pointer}.card:hover{background:rgba(127,127,127,.1)}
  .row{display:flex;gap:9px;align-items:center}.number{font:12px ui-monospace,monospace;opacity:.65}.title{font-weight:600;margin:5px 0}.meta{font-size:12px;opacity:.65}.badge{padding:2px 7px;border-radius:999px;background:rgba(34,197,94,.15);color:#22c55e}.body{white-space:pre-wrap;line-height:1.55;margin-top:20px}
  .error{padding:14px;border:1px solid #ef4444;border-radius:8px;color:#ef4444}button{border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:transparent;color:inherit;cursor:pointer}button:hover{background:rgba(127,127,127,.12)}
`
document.head.append(style)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node
}
function showError(error: unknown): void {
  const shell = el('main', 'shell'); shell.append(el('div', 'error', error instanceof Error ? error.message : 'Provider not available')); root.replaceChildren(shell)
}
async function renderPulls(): Promise<void> {
  root.replaceChildren(el('main', 'shell', 'Loading pull requests…'))
  try {
    const pulls = await api.invoke<PullRequest[]>('github.pulls.list', { state: 'open' })
    const shell = el('main', 'shell'); const header = el('header', 'header'); header.append(el('h1', '', 'GitHub pull requests'), el('span', 'muted', `${pulls.length} open`)); shell.append(header)
    if (!pulls.length) shell.append(el('p', 'muted', 'No pull requests found. Configure the repository from Plugins settings.'))
    const list = el('div', 'list')
    for (const pull of pulls) {
      const card = el('article', 'card'); card.tabIndex = 0
      const row = el('div', 'row'); row.append(el('span', 'badge', pull.state), el('span', 'number', `#${pull.number}`)); if (pull.isDraft) row.append(el('span', 'muted', 'draft'))
      card.append(row, el('div', 'title', pull.title), el('div', 'meta', `${pull.author} · ${pull.headRef} → ${pull.baseRef}`))
      const open = () => api.navigate(`pulls/${pull.number}`); card.addEventListener('click', open); card.addEventListener('keydown', (event) => { if (event.key === 'Enter') open() }); list.append(card)
    }
    shell.append(list); root.replaceChildren(shell)
  } catch (error) { showError(error) }
}
async function renderPull(number: number): Promise<void> {
  root.replaceChildren(el('main', 'shell', 'Loading pull request…'))
  try {
    const pull = await api.invoke<PullRequest>('github.pulls.get', { number })
    const shell = el('main', 'shell'); const back = el('button', '', '← Pull requests'); back.addEventListener('click', () => api.navigate('pulls'))
    const external = el('button', '', 'Open on GitHub ↗'); external.addEventListener('click', () => api.openExternal(pull.url))
    const header = el('header', 'header'); header.append(back, external); shell.append(header, el('div', 'number', `#${pull.number}`), el('h1', '', pull.title))
    shell.append(el('div', 'meta', `${pull.author} · ${pull.headRef} → ${pull.baseRef}`), el('div', 'body', pull.body || 'No description.'))
    root.replaceChildren(shell)
  } catch (error) { showError(error) }
}
async function renderIssue(itemId: string): Promise<void> {
  root.replaceChildren(el('main', 'shell', 'Loading issue…'))
  try {
    const item = await api.invoke<WorkItem | undefined>('github.workItems.get', { itemId }); if (!item) throw new Error('Work item not found')
    const shell = el('main', 'shell'); shell.append(el('div', 'number', item.externalRef), el('h1', '', item.title), el('span', 'badge', item.statusLabel ?? item.status), el('div', 'body', item.body || 'No description.')); root.replaceChildren(shell)
  } catch (error) { showError(error) }
}
function render(path: string): void {
  const issue = /^work-items\/(.+)$/.exec(path); if (issue) { void renderIssue(decodeURIComponent(issue[1]!)); return }
  const pull = /^pulls\/(\d+)$/.exec(path); if (pull) { void renderPull(Number(pull[1])); return }
  void renderPulls()
}
render(api.getRoute()); api.onRouteChanged(render)
export {}
