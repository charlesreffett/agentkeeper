import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import * as sessionRegistry from './session-registry'
import { sendInput, interruptSession, setMobileEventNotifier, setMobileSessionsNotifier, getActiveSessionsBySessionLocalId, startSession } from './agent'
import { readSession } from './sessions'
import { listCommands, expandCommandInput } from './commands'
import { settingsStore } from './settings'
import { startAgency, createProjectMcp, generateAndPersistSessionTitle } from './orchestrator'
import { listRoles } from './roles'
import { listAgencies } from './agencies'
import { createWorktree } from './worktrees'
import { recentProjectsStore } from './store'
import { ROLE_EFFORT_VALUES } from '../shared/ipc-contract'
import type { AppSettings, ContentBlock, TranscriptEvent, StartSessionParams, AgencyScope, RoleEffort, PermissionMode } from '../shared/ipc-contract'

/** Model list mirrors apps/desktop/src/renderer/src/lib/models.ts. The renderer
 *  lib can't be imported from main, so the values are duplicated here. */
const MOBILE_MODELS = [
  { value: 'claude-opus-4-8', label: 'Opus 4.8 (most capable)' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fast)' },
]

const PERMISSION_MODES: PermissionMode[] = ['default', 'acceptEdits', 'bypassPermissions', 'plan']

/** Flatten a transcript event's content blocks into a single display string. */
function blocksToText(blocks: ContentBlock[]): string {
  // Conversation view only — keep human-readable prose. Tool calls, tool
  // results (e.g. Read output with cat -n line numbers), and thinking blocks
  // are noise on a phone, so they're dropped.
  return blocks
    .map((b) => (b.type === 'text' ? b.text : ''))
    .filter((s) => s.trim())
    .join('\n')
}

/** Map a JSONL transcript event to the LiveEvent shape the mobile app decodes. */
function transcriptToMobileEvent(ev: TranscriptEvent, sessionId: string, agentLocalId: string): unknown {
  const role = ev.role ?? (ev.kind === 'assistant' ? 'assistant' : 'user')
  return {
    uuid: ev.uuid,
    sessionId,
    agentLocalId,
    message: {
      type: role,
      message: { role, content: blocksToText(ev.content) },
    },
  }
}

const subscribers = new Map<string, Set<WebSocket>>()

// Reserved subscription topic for clients watching the whole session list
// (e.g. the mobile sessions screen) rather than one conversation's events.
const SESSIONS_TOPIC = '__sessions__'

function checkAuth(req: http.IncomingMessage, secretKey: string): boolean {
  const header = req.headers['authorization'] ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!provided || !secretKey) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secretKey))
  } catch {
    return false
  }
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += String(chunk) })
    req.on('end', () => {
      try { resolve(JSON.parse(body) as Record<string, unknown>) } catch { resolve({}) }
    })
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(body)
}

/**
 * Resolve a mobile-supplied id to a registry Session. The id may be a session
 * localId, an sdkSessionId, or an agent localId (agency agents differ from the
 * session localId) — try each in turn.
 */
function resolveSession(id: string): ReturnType<typeof sessionRegistry.getSession> {
  const direct = sessionRegistry.getSession(id)
  if (direct) return direct
  const bySdk = sessionRegistry.getSessionBySdkId(id)
  if (bySdk) return bySdk
  const agent = sessionRegistry.getAgent(id)
  if (agent) return sessionRegistry.getSession(agent.sessionLocalId)
  return null
}

export function startMobileServer(port: number, secretKey: string): http.Server {
  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`)
    console.log(`[mobile-server] ${req.method} ${reqUrl.pathname}`)
    if (!checkAuth(req, secretKey)) {
      console.warn(`[mobile-server] 401 unauthorized: ${req.method} ${reqUrl.pathname}`)
      send(res, 401, { error: 'unauthorized' })
      return
    }

    const url = reqUrl
    const pathname = url.pathname

    if (req.method === 'GET' && pathname === '/api/health') {
      send(res, 200, { ok: true, version: '0.1.0' })
      return
    }

    if (req.method === 'GET' && pathname === '/api/sessions') {
      send(res, 200, sessionRegistry.listAllSessions())
      return
    }

    if (req.method === 'GET' && pathname === '/api/settings') {
      const { mobileServer: _ms, ...safe } = settingsStore.get()
      send(res, 200, safe)
      return
    }

    // Options for the new-session form. Without ?projectPath the response omits
    // roles/agencies (those are per-project); with it they're included.
    if (req.method === 'GET' && pathname === '/api/new-session/options') {
      const settings = settingsStore.get()
      const projectPath = url.searchParams.get('projectPath')
      const payload: Record<string, unknown> = {
        projects: recentProjectsStore.list(),
        focusedProjectPath: recentProjectsStore.getFocused(),
        models: MOBILE_MODELS,
        defaultModel: settings.defaultModel,
        defaultEffort: settings.defaultEffort,
        defaultUseWorktree: settings.defaultUseWorktree,
        efforts: ROLE_EFFORT_VALUES,
        permissionModes: PERMISSION_MODES,
      }
      if (projectPath) {
        payload.roles = await listRoles(projectPath)
        payload.agencies = await listAgencies(projectPath)
      }
      send(res, 200, payload)
      return
    }

    if (req.method === 'POST' && pathname === '/api/sessions') {
      const body = await parseBody(req)
      const projectPath = typeof body.projectPath === 'string' ? body.projectPath : ''
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
      if (!projectPath) { send(res, 400, { error: 'projectPath required' }); return }
      if (!prompt) { send(res, 400, { error: 'prompt required' }); return }
      const useWorktree = body.useWorktree === true
      const branch = typeof body.branch === 'string' ? body.branch.trim() : ''
      const model = typeof body.model === 'string' && body.model ? body.model : undefined

      try {
        const agencyKey = typeof body.agencyKey === 'string' ? body.agencyKey : ''
        if (agencyKey) {
          const sep = agencyKey.indexOf(':')
          const agencyScope = agencyKey.slice(0, sep) as AgencyScope
          const agencyId = agencyKey.slice(sep + 1)
          const instance = await startAgency({
            projectPath,
            agencyId,
            agencyScope,
            initialPrompt: prompt,
            useWorktree,
            ...(useWorktree && branch ? { branch } : {}),
            ...(model ? { model } : {}),
          })
          send(res, 200, { sessionId: instance.instanceId })
          return
        }

        const roleId = typeof body.roleId === 'string' ? body.roleId : ''
        const effort = typeof body.effort === 'string' ? (body.effort as RoleEffort) : undefined
        const permissionMode = typeof body.permissionMode === 'string'
          ? (body.permissionMode as PermissionMode)
          : undefined
        const role = roleId
          ? (await listRoles(projectPath)).find((r) => r.id === roleId) ?? null
          : null

        let worktreePath: string | undefined
        if (useWorktree && branch) {
          const wt = await createWorktree(projectPath, { branchRequest: branch })
          worktreePath = wt.path
        }

        const params: StartSessionParams = {
          projectPath,
          ...(worktreePath ? { worktreePath } : {}),
          ...(role?.systemPrompt ? { systemPromptAppend: role.systemPrompt } : {}),
          ...(role?.allowedTools && role.allowedTools.length ? { allowedTools: role.allowedTools } : {}),
          initialPrompt: prompt,
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(permissionMode ? { permissionMode } : {}),
          ...(role?.name ? { roleName: role.name } : {}),
          ...(role?.id ? { roleId: role.id } : {}),
        }
        const agentLocalId = await startSession(params, {
          mcpFactory: () => createProjectMcp(projectPath),
        })
        void generateAndPersistSessionTitle(agentLocalId, prompt)
        send(res, 200, { sessionId: agentLocalId })
      } catch (err) {
        console.error('[mobile-server] create session failed:', err)
        send(res, 500, { error: err instanceof Error ? err.message : String(err) })
      }
      return
    }

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch && req.method === 'GET') {
      const id = sessionMatch[1]!
      const session = resolveSession(id)
      if (!session) { send(res, 404, { error: 'not found' }); return }
      const agents = sessionRegistry.listAgentsBySession(session.localId)
      send(res, 200, { ...session, agents })
      return
    }

    const eventsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/events$/)
    if (eventsMatch && req.method === 'GET') {
      const id = eventsMatch[1]!
      const session = resolveSession(id)
      if (!session) {
        const all = sessionRegistry.listAllSessions()
        console.warn(`[mobile-server] events: session ${id} not resolved. registry has ${all.length} sessions: ${all.slice(0, 10).map(s => s.localId).join(', ')}`)
        send(res, 404, { error: 'not found' })
        return
      }
      const agents = sessionRegistry.listAgentsBySession(session.localId)
      const entry = agents.find(a => a.isEntryPoint) ?? agents[0]
      console.log(`[mobile-server] events: reqId=${id} resolved=${session.localId} agents=${agents.length} entry=${entry?.localId ?? 'none'} sdkSessionId=${entry?.sdkSessionId ?? 'none'} project=${session.projectPath} harness=${session.harnessId}`)
      if (!entry?.sdkSessionId) {
        console.warn(`[mobile-server] events: no sdkSessionId for session ${id} — returning []`)
        send(res, 200, [])
        return
      }
      const transcript = await readSession(session.projectPath, entry.sdkSessionId, session.harnessId)
      const rawCount = transcript?.events.length ?? 0
      // Chronological prose-only turns. Pagination walks this list from the tail
      // backwards: `before` is a uuid cursor, `limit` the page size.
      const filtered = (transcript?.events ?? [])
        .filter(e => e.kind === 'user' || e.kind === 'assistant')
        .filter(e => !e.isMeta && !e.isSidechain)
        .filter(e => blocksToText(e.content).trim().length > 0)
      const limitParam = Number(url.searchParams.get('limit'))
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 25
      const before = url.searchParams.get('before')
      let endIdx = filtered.length
      if (before) {
        const idx = filtered.findIndex(e => e.uuid === before)
        if (idx >= 0) endIdx = idx // exclusive: page is the events strictly before the cursor
      }
      const startIdx = Math.max(0, endIdx - limit)
      const events = filtered.slice(startIdx, endIdx).map(e => transcriptToMobileEvent(e, id, entry.localId))
      console.log(`[mobile-server] events: transcript=${transcript ? 'found' : 'null'} rawEvents=${rawCount} filtered=${filtered.length} limit=${limit} before=${before ?? 'none'} window=[${startIdx},${endIdx}) returned=${events.length}`)
      send(res, 200, events)
      return
    }

    const commandsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/commands$/)
    if (commandsMatch && req.method === 'GET') {
      const id = commandsMatch[1]!
      const session = resolveSession(id)
      if (!session) { send(res, 404, { error: 'not found' }); return }
      send(res, 200, await listCommands(session.projectPath))
      return
    }

    const inputMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/input$/)
    if (inputMatch && req.method === 'POST') {
      const id = inputMatch[1]!
      const body = await parseBody(req)
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text) { send(res, 400, { error: 'text required' }); return }
      const session = resolveSession(id)
      const agents = session ? sessionRegistry.listAgentsBySession(session.localId) : []
      const entry = agents.find(a => a.isEntryPoint) ?? agents[0]
      if (!entry) { send(res, 404, { error: 'entry-point agent not found' }); return }
      const expanded = session ? await expandCommandInput(session.projectPath, text) : text
      await sendInput(entry.localId, expanded, [])
      send(res, 200, { ok: true })
      return
    }

    const interruptMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/interrupt$/)
    if (interruptMatch && req.method === 'POST') {
      const id = interruptMatch[1]!
      await interruptSession(id)
      send(res, 200, { ok: true })
      return
    }

    send(res, 404, { error: 'not found' })
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    console.log(`[mobile-server] ws upgrade ${url.pathname}`)
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    if (!checkAuth(req, secretKey)) {
      console.warn('[mobile-server] ws upgrade 401 unauthorized')
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', ws => {
    console.log('[mobile-server] ws client connected')
    ws.on('message', data => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; sessionId?: string }
        console.log(`[mobile-server] ws message type=${msg.type} sessionId=${msg.sessionId ?? 'none'}`)
        if (msg.type === 'subscribe' && msg.sessionId) {
          let set = subscribers.get(msg.sessionId)
          if (!set) {
            set = new Set()
            subscribers.set(msg.sessionId, set)
          }
          set.add(ws)
          if (msg.sessionId === SESSIONS_TOPIC) {
            console.log('[mobile-server] ws subscribe sessions-list topic')
            return
          }
          // Replay buffered events for any currently-active agents in this session
          const activeSessions = getActiveSessionsBySessionLocalId(msg.sessionId)
          let replayed = 0
          for (const as_ of activeSessions) {
            for (const evt of as_.events) {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                  sessionId: as_.sessionLocalId,
                  agentLocalId: as_.agentLocalId,
                  message: evt,
                }))
                replayed++
              }
            }
          }
          console.log(`[mobile-server] ws subscribe session=${msg.sessionId} activeAgents=${activeSessions.length} replayedEvents=${replayed}`)
        }
      } catch (err) {
        console.warn('[mobile-server] ws malformed message:', err)
      }
    })

    ws.on('close', () => {
      console.log('[mobile-server] ws client disconnected')
      for (const [sid, set] of subscribers) {
        set.delete(ws)
        if (set.size === 0) subscribers.delete(sid)
      }
    })
  })

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      ws.ping()
    }
  }, 30_000)

  server.on('close', () => clearInterval(heartbeat))

  server.listen(port, () => console.log(`[mobile-server] listening on port ${port}`))
  return server
}

export function stopMobileServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => { if (err) reject(err); else resolve() })
  })
}

export function broadcastSessionsChanged(): void {
  const set = subscribers.get(SESSIONS_TOPIC)
  if (!set) return
  const payload = JSON.stringify({ type: 'sessions-changed' })
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

let sessionsChangedTimer: ReturnType<typeof setTimeout> | null = null

// Status updates fire many times per running turn; coalesce them into one
// list-refresh ping so the phone reloads at most ~5x/sec.
function scheduleSessionsChanged(): void {
  if (sessionsChangedTimer) return
  sessionsChangedTimer = setTimeout(() => {
    sessionsChangedTimer = null
    broadcastSessionsChanged()
  }, 200)
}

export function notifyMobileSubscribers(sessionId: string, event: unknown): void {
  const set = subscribers.get(sessionId)
  if (!set) return
  const payload = JSON.stringify(event)
  let sent = 0
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) { ws.send(payload); sent++ }
  }
  console.log(`[mobile-server] notify session=${sessionId} subscribers=${set.size} sent=${sent}`)
}

let _server: http.Server | null = null
let _serverPort = 0

export function syncMobileServer(settings: AppSettings): void {
  setMobileEventNotifier(notifyMobileSubscribers)
  setMobileSessionsNotifier(scheduleSessionsChanged)
  const cfg = settings.mobileServer
  const shouldRun = !!(cfg?.enabled && cfg.secretKey)
  if (shouldRun) {
    if (_server && _serverPort === cfg!.port) return
    if (_server) { void stopMobileServer(_server); _server = null }
    _server = startMobileServer(cfg!.port, cfg!.secretKey)
    _serverPort = cfg!.port
  } else {
    if (_server) { void stopMobileServer(_server); _server = null; _serverPort = 0 }
  }
}

export function teardownMobileServer(): Promise<void> {
  if (!_server) return Promise.resolve()
  const s = _server
  _server = null
  _serverPort = 0
  return stopMobileServer(s)
}
