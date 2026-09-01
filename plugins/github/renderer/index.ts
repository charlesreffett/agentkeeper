import DOMPurify from 'dompurify'
import { marked } from 'marked'

type PluginApi = { getRoute(): string; invoke<T>(command: string, args?: unknown): Promise<T>; navigate(path: string): void; openExternal(url: string): void; onRouteChanged(listener: (path: string) => void): () => void }
type PullRequest = { number: number; title: string; state: string; author: string; url: string; repo: string; isDraft: boolean; headRef: string; baseRef: string; updatedAt: string; body?: string }
type GitHubProject = { projectPath: string; projectName: string; repo: string }
type WorkItem = { id: string; externalRef: string; title: string; body: string; statusLabel?: string; status: string }
declare global { interface Window { agentkeeperPlugin: PluginApi } }

const api = window.agentkeeperPlugin
const root = document.querySelector<HTMLDivElement>('#app')!
let selectedProjectPath = ''
const style = document.createElement('style')
style.textContent = `
  :root{color-scheme:light dark}*{box-sizing:border-box}.shell{min-height:100%;padding:24px;max-width:1200px;margin:auto}.header{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:20px}.heading{min-width:0}h1{font-size:20px;margin:3px 0 0}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;opacity:.55}.controls{display:flex;align-items:center;gap:8px}.project-select{min-width:240px;max-width:380px;border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:Canvas;color:CanvasText}.list{display:flex;flex-direction:column;gap:9px}.card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:14px;background:rgba(127,127,127,.05);cursor:pointer}.card:hover{background:rgba(127,127,127,.1)}.row{display:flex;gap:9px;align-items:center}.number{font:12px ui-monospace,monospace;opacity:.65}.title{font-weight:600;margin:5px 0}.meta{font-size:12px;opacity:.65}.badge{padding:2px 7px;border-radius:999px;background:rgba(34,197,94,.15);color:#22c55e}.error{margin:24px;padding:14px;border:1px solid #ef4444;border-radius:8px;color:#ef4444}.empty{padding:48px;text-align:center;opacity:.65}.action{border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:transparent;color:inherit;cursor:pointer}.action:hover{background:rgba(127,127,127,.12)}
  .markdown-body{line-height:1.6;margin-top:24px;overflow-wrap:anywhere}.markdown-body>:first-child{margin-top:0}.markdown-body>:last-child{margin-bottom:0}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4,.markdown-body h5,.markdown-body h6{line-height:1.25;margin:24px 0 12px;font-weight:650}.markdown-body h1{font-size:1.75em}.markdown-body h2{font-size:1.4em;padding-bottom:7px;border-bottom:1px solid rgba(127,127,127,.28)}.markdown-body h3{font-size:1.18em}.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body pre,.markdown-body table{margin:0 0 16px}.markdown-body ul,.markdown-body ol{padding-left:2em}.markdown-body li+li{margin-top:4px}.markdown-body li>p{margin-bottom:8px}.markdown-body a{color:#58a6ff;text-decoration:none}.markdown-body a:hover{text-decoration:underline}.markdown-body blockquote{padding:2px 16px;border-left:4px solid rgba(127,127,127,.4);opacity:.8}.markdown-body code{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;padding:.18em .38em;border-radius:5px;background:rgba(127,127,127,.16)}.markdown-body pre{padding:14px 16px;border:1px solid rgba(127,127,127,.22);border-radius:8px;background:rgba(127,127,127,.1);overflow:auto}.markdown-body pre code{padding:0;background:transparent;font-size:12px}.markdown-body table{display:block;width:max-content;max-width:100%;border-collapse:collapse;overflow:auto}.markdown-body th,.markdown-body td{padding:7px 12px;border:1px solid rgba(127,127,127,.3)}.markdown-body th{background:rgba(127,127,127,.1)}.markdown-body hr{height:1px;border:0;background:rgba(127,127,127,.3);margin:24px 0}.markdown-body img{max-width:100%;height:auto;border-radius:6px}.markdown-body input[type=checkbox]{margin:0 7px 0 -1.4em;vertical-align:middle}
`
document.head.append(style)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function showError(error?: unknown): void { root.replaceChildren(el('div', 'error', error instanceof Error ? error.message : 'Provider not available')) }
function markdownBody(markdown: string, baseUrl?: string): HTMLDivElement {
  const body = el('div', 'markdown-body')
  const rendered = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string
  body.innerHTML = DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['style'],
  })
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try {
      const url = new URL(link.getAttribute('href')!, baseUrl)
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported link protocol')
      link.href = url.href
      link.addEventListener('click', (event) => { event.preventDefault(); api.openExternal(url.href) })
    } catch { link.removeAttribute('href') }
  }
  for (const image of body.querySelectorAll<HTMLImageElement>('img[src]')) {
    try {
      const url = new URL(image.getAttribute('src')!, baseUrl)
      if (!['https:', 'http:', 'data:'].includes(url.protocol)) throw new Error('Unsupported image protocol')
      image.src = url.href
    } catch { image.remove() }
  }
  return body
}
async function renderPulls(): Promise<void> {
  root.replaceChildren(el('div', 'empty', 'Loading projects…'))
  try {
    const projects = await api.invoke<GitHubProject[]>('github.projects.list')
    if (!projects.some((project) => project.projectPath === selectedProjectPath)) selectedProjectPath = projects[0]?.projectPath ?? ''
    const selected = projects.find((project) => project.projectPath === selectedProjectPath)
    const pulls = selected ? await api.invoke<PullRequest[]>('github.pulls.list', { repo: selected.repo, state: 'open' }) : []
    const shell = el('main', 'shell'), header = el('header', 'header'), heading = el('div', 'heading'), controls = el('div', 'controls')
    heading.append(el('div', 'eyebrow', selected ? `${pulls.length} open · ${selected.repo}` : 'No project selected'), el('h1', '', 'GitHub pull requests'))
    const picker = el('select', 'project-select')
    if (!projects.length) { const option = el('option', '', 'No GitHub projects'); option.value = ''; picker.append(option); picker.disabled = true }
    for (const project of projects) { const option = el('option', '', `${project.projectName} — ${project.repo}`); option.value = project.projectPath; option.selected = project.projectPath === selectedProjectPath; picker.append(option) }
    picker.addEventListener('change', () => { selectedProjectPath = picker.value; void renderPulls() })
    controls.append(picker); header.append(heading, controls); shell.append(header)
    if (!selected) shell.append(el('div', 'empty', 'No registered AgentKeeper projects have a GitHub remote. Add a project from the AgentKeeper project manager.'))
    else if (!pulls.length) shell.append(el('div', 'empty', 'No open pull requests for this project.'))
    const list = el('div', 'list')
    for (const pull of pulls) { const card = el('article', 'card'); card.tabIndex = 0; const row = el('div', 'row'); row.append(el('span', 'badge', pull.state), el('span', 'number', `#${pull.number}`)); if (pull.isDraft) row.append(el('span', 'meta', 'draft')); card.append(row, el('div', 'title', pull.title), el('div', 'meta', `${pull.author} · ${pull.headRef} → ${pull.baseRef}`)); const open = () => api.navigate(`pulls/${encodeURIComponent(pull.repo)}/${pull.number}`); card.addEventListener('click', open); card.addEventListener('keydown', (event) => { if (event.key === 'Enter') open() }); list.append(card) }
    shell.append(list); root.replaceChildren(shell)
  } catch (error) { showError(error) }
}

async function renderPull(repo: string, number: number): Promise<void> {
  root.replaceChildren(el('div', 'empty', 'Loading pull request…'))
  try { const pull = await api.invoke<PullRequest>('github.pulls.get', { repo, number }); const shell = el('main', 'shell'), back = el('button', 'action', '← Pull requests'), external = el('button', 'action', 'Open on GitHub ↗'); back.addEventListener('click', () => api.navigate('pulls')); external.addEventListener('click', () => api.openExternal(pull.url)); const header = el('header', 'header'); header.append(back, external); shell.append(header, el('div', 'number', `${pull.repo}#${pull.number}`), el('h1', '', pull.title), el('div', 'meta', `${pull.author} · ${pull.headRef} → ${pull.baseRef}`), markdownBody(pull.body || '*No description.*', pull.url)); root.replaceChildren(shell) } catch (error) { showError(error) }
}

async function renderIssue(itemId: string): Promise<void> { try { const item = await api.invoke<WorkItem | undefined>('github.workItems.get', { itemId }); if (!item) throw new Error('Work item not found'); const shell = el('main', 'shell'); shell.append(el('div', 'number', item.externalRef), el('h1', '', item.title), el('span', 'badge', item.statusLabel ?? item.status), markdownBody(item.body || '*No description.*')); root.replaceChildren(shell) } catch (error) { showError(error) } }
function render(path: string): void { const issue = /^work-items\/(.+)$/.exec(path); if (issue) { void renderIssue(decodeURIComponent(issue[1]!)); return } const pull = /^pulls\/(.+)\/(\d+)$/.exec(path); if (pull) { void renderPull(decodeURIComponent(pull[1]!), Number(pull[2])); return } void renderPulls() }
render(api.getRoute()); api.onRouteChanged(render)
export {}
