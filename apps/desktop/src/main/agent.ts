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

interface ActiveSession {
  id: string
  sdkSessionId: string | null
  projectPath: string
  model: string | undefined
  query: Query
  input: AsyncQueue<SDKUserMessage>
  abortController: AbortController
  status: LiveSessionStatus
  startedAt: number
}

const active = new Map<string, ActiveSession>()

function broadcastEvent(event: LiveSessionEvent): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:event', event)
  }
}

function broadcastStatus(update: LiveSessionStatusUpdate): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:status', update)
  }
}

function setStatus(s: ActiveSession, status: LiveSessionStatus, error?: string) {
  s.status = status
  broadcastStatus({ sessionId: s.id, status, error })
}

async function consumeStream(session: ActiveSession): Promise<void> {
  try {
    for await (const msg of session.query) {
      // Capture the SDK-assigned session_id from the init message
      if (msg.type === 'system') {
        const anyMsg = msg as unknown as { subtype?: string; session_id?: string }
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

export async function startSession(params: StartSessionParams): Promise<string> {
  // Auth is either:
  //   (a) an ANTHROPIC_API_KEY stored in the OS keychain (Console users), or
  //   (b) an existing `claude login` session on disk (Pro/Max users) —
  //       the SDK subprocess is the same binary as the terminal `claude` CLI,
  //       so it picks up those credentials automatically.
  // We prefer (a) if set, otherwise let the SDK fall through to (b).
  const apiKey = await secrets.get(SECRET_KEYS.anthropicApiKey)

  const id = randomUUID()
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

  const q = query({
    prompt: input,
    options: {
      cwd: params.projectPath,
      ...(params.model ? { model: params.model } : {}),
      abortController: controller,
      env: childEnv,
      // V2: no permission-prompt UI yet. Explicitly allow every tool via
      // canUseTool so we don't rely on permissionMode='bypassPermissions'
      // (which gates behind an extra safety flag) or 'default' (which would
      // hang waiting for a prompt UI we haven't built yet).
      permissionMode: 'default',
      canUseTool: async (_toolName, input) => ({
        behavior: 'allow',
        updatedInput: input,
      }),
      settingSources: ['user', 'project'],
    },
  })

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

export function listActiveSessions(): Array<{
  id: string
  sdkSessionId: string | null
  projectPath: string
  status: LiveSessionStatus
  startedAt: number
  model: string | undefined
}> {
  return Array.from(active.values()).map((s) => ({
    id: s.id,
    sdkSessionId: s.sdkSessionId,
    projectPath: s.projectPath,
    status: s.status,
    startedAt: s.startedAt,
    model: s.model,
  }))
}
