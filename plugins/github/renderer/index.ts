import DOMPurify from 'dompurify'
import { marked } from 'marked'

type PluginApi = { getRoute(): string; invoke<T>(command: string, args?: unknown): Promise<T>; navigate(path: string): void; openExternal(url: string): void; onRouteChanged(listener: (path: string) => void): () => void }
type PRState = 'open' | 'closed' | 'merged'
type CheckState = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel'
type PullRequest = { number: number; title: string; state: PRState; author: string; url: string; repo: string; isDraft: boolean; headRef: string; baseRef: string; updatedAt: string; body?: string; labels: string[]; reviewDecision: string | null; checksState: CheckState | null; additions?: number; deletions?: number; changedFiles?: number; mergeable?: string; comments?: PRComment[]; reviews?: PRReview[] }
type PRComment = { id: number; author: string; body: string; createdAt: string; path?: string; line?: number }
type PRReview = { id: number; author: string; state: string; body: string; submittedAt: string }
type CheckRun = { name: string; state: CheckState; conclusion: string | null; link: string }
type GitHubProject = { projectPath: string; projectName: string; repo: string }
type WorkItem = { id: string; externalRef: string; title: string; body: string; statusLabel?: string; status: string }
declare global { interface Window { agentkeeperPlugin: PluginApi } }

const api = window.agentkeeperPlugin
const root = document.querySelector<HTMLDivElement>('#app')!
let selectedProjectPath = ''
let stateFilter: PRState | 'all' = 'open'
let searchQuery = ''
let renderGeneration = 0

const style = document.createElement('style')
style.textContent = `
  :root{color-scheme:light dark}*{box-sizing:border-box}body{overflow:hidden}button,input,select,textarea{font:inherit}.shell{height:100%;padding:24px;max-width:1200px;margin:auto;overflow:auto}.header{display:flex;justify-content:space-between;align-items:end;gap:18px;margin-bottom:20px}.heading{min-width:0}.eyebrow{font-size:10px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;opacity:.55}h1{font-size:20px;margin:3px 0 0;line-height:1.3}.controls,.actions,.tabs,.summary{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.project-select,.filter,.search,.textarea{border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:Canvas;color:CanvasText}.project-select{min-width:220px;max-width:360px}.search{width:210px}.list{display:flex;flex-direction:column;gap:9px}.card{border:1px solid rgba(127,127,127,.3);border-radius:10px;padding:14px;background:rgba(127,127,127,.05);cursor:pointer}.card:hover,.card:focus{background:rgba(127,127,127,.1);outline:none}.row{display:flex;gap:9px;align-items:center}.number{font:12px ui-monospace,monospace;opacity:.65}.title{font-weight:600;margin:5px 0}.meta{font-size:12px;opacity:.65}.badge{padding:2px 7px;border-radius:999px;background:rgba(34,197,94,.15);color:#22c55e;font-size:11px}.badge.closed{background:rgba(168,85,247,.14);color:#a855f7}.badge.fail{background:rgba(239,68,68,.14);color:#ef4444}.badge.pending{background:rgba(245,158,11,.14);color:#f59e0b}.error{margin:24px;padding:14px;border:1px solid #ef4444;border-radius:8px;color:#ef4444}.empty,.loading{padding:48px;text-align:center;opacity:.65}.action{border:1px solid rgba(127,127,127,.35);border-radius:7px;padding:7px 10px;background:transparent;color:inherit;cursor:pointer}.action:hover{background:rgba(127,127,127,.12)}.action.primary{border-color:#2563eb;background:#2563eb;color:#fff}.action:disabled{opacity:.5;cursor:default}.detail{height:100%;display:flex;flex-direction:column}.detail-top{padding:20px 24px 14px;border-bottom:1px solid rgba(127,127,127,.25)}.detail-title{display:flex;align-items:start;justify-content:space-between;gap:18px}.detail-scroll{flex:1;min-height:0;overflow:auto;padding:20px 24px}.tabs{margin-top:16px}.tab{border:0;border-bottom:2px solid transparent;padding:8px 2px;background:transparent;color:inherit;opacity:.65;cursor:pointer}.tab.active{border-color:#3b82f6;opacity:1}.panel{max-width:1000px;margin:auto}.comment,.review,.check{border:1px solid rgba(127,127,127,.25);border-radius:9px;padding:14px;margin-bottom:12px}.comment-head,.check{display:flex;align-items:center;gap:10px}.comment-head{margin-bottom:9px}.avatar{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:rgba(127,127,127,.18);font-weight:700;font-size:11px}.grow{flex:1;min-width:0}.textarea{width:100%;min-height:90px;resize:vertical;margin-top:10px}.form-actions{display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:8px}.status-pass{color:#22c55e}.status-fail{color:#ef4444}.status-pending{color:#f59e0b}.review-state{font-size:10px;padding:2px 7px;border-radius:999px;background:rgba(127,127,127,.15)}
  .markdown-body{line-height:1.6;overflow-wrap:anywhere}.markdown-body>:first-child{margin-top:0}.markdown-body>:last-child{margin-bottom:0}.markdown-body h1,.markdown-body h2,.markdown-body h3,.markdown-body h4{line-height:1.25;margin:22px 0 10px;font-weight:650}.markdown-body h1{font-size:1.65em}.markdown-body h2{font-size:1.35em;padding-bottom:7px;border-bottom:1px solid rgba(127,127,127,.28)}.markdown-body h3{font-size:1.15em}.markdown-body p,.markdown-body ul,.markdown-body ol,.markdown-body blockquote,.markdown-body pre,.markdown-body table{margin:0 0 14px}.markdown-body ul,.markdown-body ol{padding-left:2em}.markdown-body a{color:#58a6ff;text-decoration:none}.markdown-body a:hover{text-decoration:underline}.markdown-body blockquote{padding:2px 16px;border-left:4px solid rgba(127,127,127,.4);opacity:.8}.markdown-body code{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;padding:.18em .38em;border-radius:5px;background:rgba(127,127,127,.16)}.markdown-body pre{padding:14px 16px;border:1px solid rgba(127,127,127,.22);border-radius:8px;background:rgba(127,127,127,.1);overflow:auto}.markdown-body pre code{padding:0;background:transparent}.markdown-body table{display:block;width:max-content;max-width:100%;border-collapse:collapse;overflow:auto}.markdown-body th,.markdown-body td{padding:7px 12px;border:1px solid rgba(127,127,127,.3)}.markdown-body img{max-width:100%;height:auto;border-radius:6px}
  @media(max-width:800px){.header,.detail-title{align-items:stretch;flex-direction:column}.controls{align-items:stretch}.project-select,.search{width:100%;max-width:none}.shell{padding:16px}}
`
document.head.append(style)

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function showError(error?: unknown): void { root.replaceChildren(el('div', 'error', error instanceof Error ? error.message : 'Provider not available')) }
function relativeTime(iso: string): string { const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)); if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; const days = Math.floor(hours / 24); return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString() }
function markdownBody(markdown: string, baseUrl?: string): HTMLDivElement {
  const body = el('div', 'markdown-body')
  body.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { async: false, gfm: true }) as string, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form'], FORBID_ATTR: ['style'] })
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) { try { const url = new URL(link.getAttribute('href')!, baseUrl); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); link.href = url.href; link.addEventListener('click', event => { event.preventDefault(); api.openExternal(url.href) }) } catch { link.removeAttribute('href') } }
  for (const image of body.querySelectorAll<HTMLImageElement>('img[src]')) { try { const url = new URL(image.getAttribute('src')!, baseUrl); if (!['https:', 'http:', 'data:'].includes(url.protocol)) throw new Error(); image.src = url.href } catch { image.remove() } }
  return body
}

async function renderPulls(): Promise<void> {
  const generation = ++renderGeneration; root.replaceChildren(el('div', 'loading', 'Loading pull requests…'))
  try {
    const projects = await api.invoke<GitHubProject[]>('github.projects.list')
    if (!projects.some(project => project.projectPath === selectedProjectPath)) selectedProjectPath = projects[0]?.projectPath ?? ''
    const selected = projects.find(project => project.projectPath === selectedProjectPath)
    const pulls = selected ? await api.invoke<PullRequest[]>('github.pulls.list', { repo: selected.repo, state: stateFilter }) : []
    if (generation !== renderGeneration) return
    const query = searchQuery.trim().toLowerCase(), visible = pulls.filter(pull => !query || `${pull.title} ${pull.author} ${pull.number}`.toLowerCase().includes(query))
    const shell = el('main', 'shell'), header = el('header', 'header'), heading = el('div', 'heading'), controls = el('div', 'controls')
    heading.append(el('div', 'eyebrow', selected ? `${visible.length} pull requests · ${selected.repo}` : 'No project selected'), el('h1', '', 'GitHub pull requests'))
    const picker = el('select', 'project-select'); if (!projects.length) { picker.append(el('option', '', 'No GitHub projects')); picker.disabled = true }
    for (const project of projects) { const option = el('option', '', `${project.projectName} — ${project.repo}`); option.value = project.projectPath; option.selected = project.projectPath === selectedProjectPath; picker.append(option) }
    picker.addEventListener('change', () => { selectedProjectPath = picker.value; void renderPulls() })
    const state = el('select', 'filter'); for (const value of ['open', 'closed', 'merged', 'all'] as const) { const option = el('option', '', value[0]!.toUpperCase() + value.slice(1)); option.value = value; option.selected = value === stateFilter; state.append(option) }
    state.addEventListener('change', () => { stateFilter = state.value as typeof stateFilter; void renderPulls() })
    const search = el('input', 'search'); search.type = 'search'; search.placeholder = 'Search pull requests'; search.value = searchQuery; search.addEventListener('input', () => { searchQuery = search.value; void renderPulls().then(() => { const next = document.querySelector<HTMLInputElement>('.search'); next?.focus(); next?.setSelectionRange(searchQuery.length, searchQuery.length) }) })
    controls.append(picker, state, search); header.append(heading, controls); shell.append(header)
    if (!selected) shell.append(el('div', 'empty', 'No registered projects have a GitHub remote.')); else if (!visible.length) shell.append(el('div', 'empty', 'No pull requests match these filters.'))
    const list = el('div', 'list')
    for (const pull of visible) { const card = el('article', 'card'), row = el('div', 'row'); card.tabIndex = 0; row.append(el('span', `badge ${pull.state === 'open' ? '' : 'closed'}`, pull.state), el('span', 'number', `#${pull.number}`)); if (pull.isDraft) row.append(el('span', 'meta', 'draft')); if (pull.checksState) row.append(el('span', `badge ${pull.checksState}`, pull.checksState)); card.append(row, el('div', 'title', pull.title), el('div', 'meta', `${pull.author} · ${pull.headRef} → ${pull.baseRef} · ${relativeTime(pull.updatedAt)}`)); const open = () => api.navigate(`pulls/${encodeURIComponent(pull.repo)}/${pull.number}/conversation`); card.addEventListener('click', open); card.addEventListener('keydown', event => { if (event.key === 'Enter') open() }); list.append(card) }
    shell.append(list); root.replaceChildren(shell)
  } catch (error) { if (generation === renderGeneration) showError(error) }
}

function detailShell(pull: PullRequest, tab: string): { shell: HTMLElement; panel: HTMLElement } {
  const shell = el('main', 'detail'), top = el('div', 'detail-top'), titleRow = el('div', 'detail-title'), heading = el('div'), actions = el('div', 'actions')
  const back = el('button', 'action', '← Pull requests'); back.addEventListener('click', () => api.navigate('pulls'))
  heading.append(el('div', 'number', `${pull.repo}#${pull.number}`), el('h1', '', pull.title), el('div', 'meta', `${pull.author} · ${pull.headRef} → ${pull.baseRef}`))
  const refresh = el('button', 'action', 'Refresh'); refresh.addEventListener('click', () => render(api.getRoute()))
  const external = el('button', 'action', 'Open on GitHub ↗'); external.addEventListener('click', () => api.openExternal(pull.url)); actions.append(back, refresh, external)
  if (pull.state === 'open' && !pull.isDraft) { const method = el('select', 'filter'); for (const value of ['squash', 'merge', 'rebase']) { const option = el('option', '', value); option.value = value; method.append(option) } const merge = el('button', 'action primary', 'Merge'); merge.addEventListener('click', async () => { merge.disabled = true; merge.textContent = 'Merging…'; try { await api.invoke('github.pulls.merge', { repo: pull.repo, number: pull.number, method: method.value }); render(api.getRoute()) } catch (error) { showError(error) } }); actions.append(method, merge) }
  titleRow.append(heading, actions); top.append(titleRow); const stats = el('div', 'summary'); stats.style.marginTop = '12px'; stats.append(el('span', 'badge', pull.state), el('span', 'meta', `${pull.changedFiles ?? 0} files`), el('span', 'status-pass', `+${pull.additions ?? 0}`), el('span', 'status-fail', `−${pull.deletions ?? 0}`), el('span', 'meta', pull.mergeable?.toLowerCase() ?? '')); top.append(stats)
  const tabs = el('nav', 'tabs'); for (const [id, label] of [['conversation', 'Conversation'], ['checks', 'Checks'], ['reviews', 'Reviews']]) { const button = el('button', `tab${tab === id ? ' active' : ''}`, label); button.addEventListener('click', () => api.navigate(`pulls/${encodeURIComponent(pull.repo)}/${pull.number}/${id}`)); tabs.append(button) }
  top.append(tabs); const scroll = el('div', 'detail-scroll'), panel = el('section', 'panel'); scroll.append(panel); shell.append(top, scroll); return { shell, panel }
}

async function renderConversation(pull: PullRequest, panel: HTMLElement): Promise<void> {
  if (pull.body) { const description = el('article', 'comment'); description.append(markdownBody(pull.body, pull.url)); panel.append(description) }
  const comments = await api.invoke<PRComment[]>('github.pulls.comments', { repo: pull.repo, number: pull.number })
  for (const comment of comments) { const card = el('article', 'comment'), head = el('div', 'comment-head'), meta = el('div', 'grow'); meta.append(el('strong', '', comment.author), el('div', 'meta', `${relativeTime(comment.createdAt)}${comment.path ? ` · ${comment.path}${comment.line ? `:${comment.line}` : ''}` : ''}`)); head.append(el('span', 'avatar', comment.author[0]?.toUpperCase() ?? '?'), meta); card.append(head, markdownBody(comment.body, pull.url)); panel.append(card) }
  if (!pull.body && !comments.length) panel.append(el('div', 'empty', 'No conversation yet.'))
  const form = el('div', 'comment'), textarea = el('textarea', 'textarea'); textarea.placeholder = 'Leave a comment…'; const footer = el('div', 'form-actions'), status = el('span', 'meta'), submit = el('button', 'action primary', 'Comment')
  submit.addEventListener('click', async () => { const body = textarea.value.trim(); if (!body) return; submit.disabled = true; status.textContent = 'Posting…'; try { await api.invoke('github.pulls.comment', { repo: pull.repo, number: pull.number, body }); render(api.getRoute()) } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); submit.disabled = false } }); footer.append(status, submit); form.append(textarea, footer); panel.append(form)
}

async function renderChecks(pull: PullRequest, panel: HTMLElement): Promise<void> {
  const checks = await api.invoke<CheckRun[]>('github.pulls.checks', { repo: pull.repo, number: pull.number }); const order: Partial<Record<CheckState, number>> = { fail: 0, pending: 1, pass: 2 }; checks.sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3))
  if (!checks.length) { panel.append(el('div', 'empty', 'No checks reported.')); return }
  const summary = el('div', 'summary'); for (const state of ['fail', 'pending', 'pass'] as const) { const count = checks.filter(check => check.state === state).length; if (count) summary.append(el('span', `status-${state}`, `${count} ${state}`)) } panel.append(summary)
  for (const check of checks) { const card = el('div', 'check'), text = el('div', 'grow'); text.append(el('strong', '', check.name), el('div', 'meta', check.conclusion ?? check.state)); card.append(el('span', `status-${check.state}`, check.state === 'pass' ? '✓' : check.state === 'fail' ? '✗' : '○'), text); if (check.link) { const details = el('button', 'action', 'Details ↗'); details.addEventListener('click', () => api.openExternal(check.link)); card.append(details) } panel.append(card) }
}

async function renderReviews(pull: PullRequest, panel: HTMLElement): Promise<void> {
  const reviews = pull.reviews ?? []; if (!reviews.length) panel.append(el('div', 'empty', 'No reviews yet.'))
  for (const review of reviews) { const card = el('article', 'review'), head = el('div', 'comment-head'); head.append(el('span', 'avatar', review.author[0]?.toUpperCase() ?? '?'), el('strong', '', review.author), el('span', 'review-state', review.state.replaceAll('_', ' ').toLowerCase()), el('span', 'meta', relativeTime(review.submittedAt))); card.append(head); if (review.body) card.append(markdownBody(review.body, pull.url)); panel.append(card) }
  const form = el('div', 'review'), select = el('select', 'filter'); for (const [value, label] of [['COMMENT', 'Comment'], ['APPROVE', 'Approve'], ['REQUEST_CHANGES', 'Request changes']]) { const option = el('option', '', label); option.value = value; select.append(option) }
  const textarea = el('textarea', 'textarea'); textarea.placeholder = 'Review summary…'; const footer = el('div', 'form-actions'), status = el('span', 'meta'), submit = el('button', 'action primary', 'Submit review')
  submit.addEventListener('click', async () => { submit.disabled = true; status.textContent = 'Submitting…'; try { await api.invoke('github.pulls.review', { repo: pull.repo, number: pull.number, event: select.value, body: textarea.value.trim() }); render(api.getRoute()) } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); submit.disabled = false } }); footer.append(status, submit); form.append(select, textarea, footer); panel.append(form)
}

async function renderPull(repo: string, number: number, tab: string): Promise<void> { const generation = ++renderGeneration; root.replaceChildren(el('div', 'loading', 'Loading pull request…')); try { const pull = await api.invoke<PullRequest>('github.pulls.get', { repo, number }); if (generation !== renderGeneration) return; const { shell, panel } = detailShell(pull, tab); root.replaceChildren(shell); if (tab === 'checks') await renderChecks(pull, panel); else if (tab === 'reviews') await renderReviews(pull, panel); else await renderConversation(pull, panel) } catch (error) { if (generation === renderGeneration) showError(error) } }
async function renderIssue(itemId: string): Promise<void> { const generation = ++renderGeneration; root.replaceChildren(el('div', 'loading', 'Loading work item…')); try { const item = await api.invoke<WorkItem | undefined>('github.workItems.get', { itemId }); if (!item) throw new Error('Work item not found'); if (generation !== renderGeneration) return; const shell = el('main', 'shell'); shell.append(el('div', 'number', item.externalRef), el('h1', '', item.title), el('span', 'badge', item.statusLabel ?? item.status), markdownBody(item.body || '*No description.*')); root.replaceChildren(shell) } catch (error) { if (generation === renderGeneration) showError(error) } }
function render(path: string): void { const issue = /^work-items\/(.+)$/.exec(path); if (issue) { void renderIssue(decodeURIComponent(issue[1]!)); return } const pull = /^pulls\/(.+)\/(\d+)(?:\/(conversation|checks|reviews))?$/.exec(path); if (pull) { void renderPull(decodeURIComponent(pull[1]!), Number(pull[2]), pull[3] ?? 'conversation'); return } void renderPulls() }
render(api.getRoute()); api.onRouteChanged(render)
export {}
