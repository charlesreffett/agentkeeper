import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {
  LiveSessionEvent,
  LiveSessionStatus,
  LiveSessionStatusUpdate,
  StartSessionParams,
} from '../shared/ipc-contract'
import { AsyncQueue } from './async-queue'
import { secrets, SECRET_KEYS } from './secrets'

export interface ActiveSession {
  id: string
  sdkSessionId: string | null
  projectPath: string
  model: string | undefined
  query: Query
  input: AsyncQueue<SDKUserMessage>
  abortController: AbortController
  status: LiveSessionStatus
  startedAt: number
  /** Agency membership (null if freestanding). */
  agencyInstanceId: string | null
  roleId: string | null
  /** Full SDK message history for orchestrator routing. */
  events: SDKMessage[]
  /** Resolvers awaiting next terminal status (idle/completed/error/cancelled). */
  idleWaiters: Array<(status: LiveSessionStatus) => void>
}

/** Optional extras orchestrator passes to startSession that aren't in the
 *  IPC contract (mcpServers is an SDK object, not transportable). */
export interface InternalStartExtras {
  mcpServer?: ReturnType<
    typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
  >
}

const active = new Map<string, ActiveSession>()

/**
 * Deep-plain an object so Electron's structured-clone IPC can serialize it.
 * The Agent SDK returns objects from @anthropic-ai/sdk which can have class
 * prototypes, getters, or non-enumerable properties that structured-clone
 * refuses ("an object could not be cloned"). JSON round-trip produces a
 * plain-object tree with only structured-clone-safe values.
 */
function toPlain<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch (err) {
    return {
      _unclonable: true,
      _reason: err instanceof Error ? err.message : String(err),
    } as unknown as T
  }
}

function broadcastEvent(event: LiveSessionEvent): void {
  const payload = toPlain(event)
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:event', payload)
  }
}

function broadcastStatus(update: LiveSessionStatusUpdate): void {
  const payload = toPlain(update)
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:status', payload)
  }
}

const TERMINAL_STATUSES: LiveSessionStatus[] = [
  'idle',
  'completed',
  'cancelled',
  'error',
]

function setStatus(s: ActiveSession, status: LiveSessionStatus, error?: string) {
  s.status = status
  broadcastStatus({ sessionId: s.id, status, ...(error ? { error } : {}) })
  if (TERMINAL_STATUSES.includes(status)) {
    const waiters = s.idleWaiters.splice(0, s.idleWaiters.length)
    for (const w of waiters) w(status)
  }
}

async function consumeStream(session: ActiveSession): Promise<void> {
  try {
    for await (const msg of session.query) {
      session.events.push(msg)

      if (msg.type === 'system') {
        const anyMsg = msg as unknown as {
          subtype?: string
          session_id?: string
        }
        if (anyMsg.subtype === 'init' && typeof anyMsg.session_id === 'string') {
          session.sdkSessionId = anyMsg.session_id
          broadcastStatus({
            sessionId: session.id,
            status: session.status,
            sdkSessionId: anyMsg.session_id,
          })
        }
      }

      broadcastEvent({ sessionId: session.id, message: msg })

      if (msg.type === 'result') {
        setStatus(session, 'idle')
      }
    }
    setStatus(session, 'completed')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[agent] session ${session.id} stream error:`, err)
    setStatus(session, 'error', message)
  } finally {
    active.delete(session.id)
  }
}

function messageFromText(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
  } as SDKUserMessage
}

export async function startSession(
  params: StartSessionParams,
  extras: InternalStartExtras = {},
): Promise<string> {
  // Auth is either:
  //   (a) an ANTHROPIC_API_KEY stored in the OS keychain (Console users), or
  //   (b) an existing `claude login` session on disk (Pro/Max users) —
  //       the SDK subprocess is the same binary as the terminal `claude` CLI,
  //       so it picks up those credentials automatically.
  // We prefer (a) if set, otherwise let the SDK fall through to (b).
  const apiKey = await secrets.get(SECRET_KEYS.anthropicApiKey)

  const id = params.localId ?? randomUUID()
  const controller = new AbortController()
  const input = new AsyncQueue<SDKUserMessage>()
  input.push(messageFromText(params.initialPrompt))

  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'orchestral-ai',
  }
  if (apiKey) {
    childEnv['ANTHROPIC_API_KEY'] = apiKey
  }

  const cwd = params.worktreePath ?? params.projectPath

  const options: Parameters<typeof query>[0]['options'] = {
    cwd,
    ...(params.model ? { model: params.model } : {}),
    ...(params.effort ? { effort: params.effort } : {}),
    abortController: controller,
    env: childEnv,
    permissionMode: 'bypassPermissions',
    settingSources: ['user', 'project'],
  }
  if (params.systemPromptAppend) {
    options!.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: params.systemPromptAppend,
    }
  }
  if (params.allowedTools && params.allowedTools.length) {
    options!.allowedTools = params.allowedTools
  }
  if (extras.mcpServer) {
    options!.mcpServers = { orchestral: extras.mcpServer }
  }

  const q = query({ prompt: input, options })

  const session: ActiveSession = {
    id,
    sdkSessionId: null,
    projectPath: params.projectPath,
    model: params.model,
    query: q,
    input,
    abortController: controller,
    status: 'starting',
    startedAt: Date.now(),
    agencyInstanceId: params.agencyInstanceId ?? null,
    roleId: params.roleId ?? null,
    events: [],
    idleWaiters: [],
  }

  active.set(id, session)
  broadcastStatus({ sessionId: id, status: 'starting' })
  setStatus(session, 'running')

  void consumeStream(session)

  return id
}

export function sendInput(sessionId: string, text: string): void {
  const s = active.get(sessionId)
  if (!s) throw new Error(`session ${sessionId} not found or not active`)
  s.input.push(messageFromText(text))
  setStatus(s, 'running')
}

export async function cancelSession(sessionId: string): Promise<void> {
  const s = active.get(sessionId)
  if (!s) return
  try {
    s.input.close()
  } catch {
    /* ignore */
  }
  try {
    await s.query.interrupt()
  } catch {
    /* ignore */
  }
  try {
    s.abortController.abort()
  } catch {
    /* ignore */
  }
  try {
    s.query.close?.()
  } catch {
    /* ignore */
  }
  setStatus(s, 'cancelled')
  active.delete(sessionId)
}

export function isSessionActive(sessionId: string): boolean {
  return active.has(sessionId)
}

export function getActiveSession(sessionId: string): ActiveSession | null {
  return active.get(sessionId) ?? null
}

/** Resolve when the session next reaches idle (or a terminal status). */
export function waitForNextIdle(
  sessionId: string,
): Promise<LiveSessionStatus> {
  const s = active.get(sessionId)
  if (!s) return Promise.reject(new Error(`session ${sessionId} not found`))
  if (TERMINAL_STATUSES.includes(s.status)) {
    return Promise.resolve(s.status)
  }
  return new Promise((resolve) => s.idleWaiters.push(resolve))
}

export function listActiveSessions(): Array<{
  id: string
  sdkSessionId: string | null
  projectPath: string
  status: LiveSessionStatus
  startedAt: number
  model: string | undefined
  agencyInstanceId: string | null
  roleId: string | null
}> {
  return Array.from(active.values()).map((s) => ({
    id: s.id,
    sdkSessionId: s.sdkSessionId,
    projectPath: s.projectPath,
    status: s.status,
    startedAt: s.startedAt,
    model: s.model,
    agencyInstanceId: s.agencyInstanceId,
    roleId: s.roleId,
  }))
}
