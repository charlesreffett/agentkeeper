import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import type { WebSocket } from 'ws'
import * as sessionRegistry from './session-registry'
import { sendInput, interruptSession, setMobileEventNotifier, getActiveSessionsBySessionLocalId } from './agent'
import { settingsStore } from './settings'
import type { AppSettings } from '../shared/ipc-contract'

const subscribers = new Map<string, Set<WebSocket>>()

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

export function startMobileServer(port: number, secretKey: string): http.Server {
  const server = http.createServer(async (req, res) => {
    if (!checkAuth(req, secretKey)) {
      send(res, 401, { error: 'unauthorized' })
      return
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
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

    const sessionMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/)
    if (sessionMatch && req.method === 'GET') {
      const id = sessionMatch[1]!
      const session = sessionRegistry.getSession(id)
      if (!session) { send(res, 404, { error: 'not found' }); return }
      const agents = sessionRegistry.listAgentsBySession(id)
      send(res, 200, { ...session, agents })
      return
    }

    const inputMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/input$/)
    if (inputMatch && req.method === 'POST') {
      const id = inputMatch[1]!
      const body = await parseBody(req)
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text) { send(res, 400, { error: 'text required' }); return }
      const agents = sessionRegistry.listAgentsBySession(id)
      const entry = agents.find(a => a.isEntryPoint)
      if (!entry) { send(res, 404, { error: 'entry-point agent not found' }); return }
      await sendInput(entry.localId, text, [])
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
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    if (!checkAuth(req, secretKey)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req)
    })
  })

  wss.on('connection', ws => {
    ws.on('message', data => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; sessionId?: string }
        if (msg.type === 'subscribe' && msg.sessionId) {
          let set = subscribers.get(msg.sessionId)
          if (!set) {
            set = new Set()
            subscribers.set(msg.sessionId, set)
          }
          set.add(ws)
          // Replay buffered events for any currently-active agents in this session
          const activeSessions = getActiveSessionsBySessionLocalId(msg.sessionId)
          for (const as_ of activeSessions) {
            for (const evt of as_.events) {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({
                  sessionId: as_.sessionLocalId,
                  agentLocalId: as_.agentLocalId,
                  message: evt,
                }))
              }
            }
          }
        }
      } catch { /* ignore malformed messages */ }
    })

    ws.on('close', () => {
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

  server.listen(port)
  return server
}

export function stopMobileServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => { if (err) reject(err); else resolve() })
  })
}

export function notifyMobileSubscribers(sessionId: string, event: unknown): void {
  const set = subscribers.get(sessionId)
  if (!set) return
  const payload = JSON.stringify(event)
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(payload)
  }
}

let _server: http.Server | null = null
let _serverPort = 0

export function syncMobileServer(settings: AppSettings): void {
  setMobileEventNotifier(notifyMobileSubscribers)
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
