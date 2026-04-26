import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
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
import type { WorkItemRegistryFull } from './plugins'
import * as registry from './session-registry'

export interface ActiveSession {
  id: string
  sdkSessionId: string | null
  projectPath: string
  worktreePath: string | undefined
  model: string | undefined
  query: Query
  input: AsyncQueue<SDKUserMessage>
  abortController: AbortController
  status: LiveSessionStatus
  startedAt: number
  initialPrompt: string
  roleName: string | null
  agencyName: string | null
  /** Agency membership (null if freestanding). */
  agencyInstanceId: string | null
  roleId: string | null
  workItemId: string | null
  /** Full SDK message history for orchestrator routing. */
  events: SDKMessage[]
  /** Resolvers awaiting next terminal status (idle/suspended/completed/error/terminated). */
  idleWaiters: Array<(status: LiveSessionStatus) => void>
  interrupted: boolean
}

/** Optional extras orchestrator passes to startSession that aren't in the
 *  IPC contract (mcpServers is an SDK object, not transportable). */
export interface InternalStartExtras {
  mcpServer?: ReturnType<
    typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
  >
}

const active = new Map<string, ActiveSession>()

let workItemRegistry: WorkItemRegistryFull | null = null

export function setWorkItemRegistry(registry: WorkItemRegistryFull): void {
  workItemRegistry = registry
}

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
  'suspended',
  'completed',
  'terminated',
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
      if (session.interrupted) break

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
          const branch = session.worktreePath
            ? path.basename(session.worktreePath)
            : null
          registry.registerSession({
            localId: session.id,
            sdkSessionId: anyMsg.session_id,
            projectPath: session.projectPath,
            worktreePath: session.worktreePath ?? null,
            branch,
            model: session.model ?? null,
            effort: null,
            initialPrompt: session.initialPrompt,
            roleName: session.roleName,
            roleId: session.roleId,
            agencyInstanceId: session.agencyInstanceId,
            agencyName: session.agencyName,
            startedAt: session.startedAt,
            lastActivityAt: Date.now(),
            status: session.status,
          })
          if (session.agencyInstanceId && session.roleId) {
            registry.updateAgency(session.agencyInstanceId, {
              roleSessionMap: { [session.roleId]: anyMsg.session_id },
              lastActivityAt: Date.now(),
            })
          }
        }
      }

      broadcastEvent({ sessionId: session.id, message: msg })

      if (msg.type === 'result') {
        setStatus(session, 'suspended')
        try { session.input.close() } catch { /* ignore */ }
        break
      }
    }
    if (session.status !== 'suspended') {
      setStatus(session, 'completed')
      if (session.workItemId && workItemRegistry) {
        const branch = session.worktreePath
          ? path.basename(session.worktreePath)
          : path.basename(session.projectPath)
        const ts = new Date().toISOString()
        workItemRegistry
          .addComment(
            session.workItemId,
            `🤖 Session completed\n\nBranch: \`${branch}\`\nFinished: ${ts}`,
          )
          .catch(() => {})
      }
    }
  } catch (err) {
    if (!session.interrupted) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[agent] session ${session.id} stream error:`, err)
      setStatus(session, 'error', message)
    }
  } finally {
    registry.updateSession(session.id, {
      status: session.status,
      lastActivityAt: Date.now(),
    })
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

  let systemPromptAppend = params.systemPromptAppend
  if (params.workItemId && workItemRegistry) {
    const item = await workItemRegistry.get(params.workItemId)
    if (item) {
      const itemContext = [
        `## Work Item: ${item.title}`,
        '',
        item.body ?? '',
        '',
        `Status: ${item.status}`,
        ...(item.assignee ? [`Assignee: ${item.assignee}`] : []),
      ].join('\n')
      systemPromptAppend = [itemContext, systemPromptAppend].filter(Boolean).join('\n\n')
    }
  }

  const id = params.localId ?? randomUUID()
  const controller = new AbortController()
  const input = new AsyncQueue<SDKUserMessage>()
  const isResume = !!params.resumeSdkSessionId
  if (!isResume) {
    input.push(messageFromText(params.initialPrompt))
  }

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
    ...(params.resumeSdkSessionId ? { resume: params.resumeSdkSessionId } : {}),
    abortController: controller,
    env: childEnv,
    permissionMode: 'bypassPermissions',
    settingSources: ['user', 'project'],
  }
  if (systemPromptAppend) {
    options!.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: systemPromptAppend,
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
    worktreePath: params.worktreePath,
    model: params.model,
    query: q,
    input,
    abortController: controller,
    status: 'starting',
    startedAt: Date.now(),
    initialPrompt: params.initialPrompt,
    roleName: params.roleName ?? null,
    agencyName: params.agencyName ?? null,
    agencyInstanceId: params.agencyInstanceId ?? null,
    roleId: params.roleId ?? null,
    workItemId: params.workItemId ?? null,
    events: [],
    idleWaiters: [],
    interrupted: false,
  }

  active.set(id, session)
  if (isResume) {
    broadcastStatus({ sessionId: id, status: 'starting' })
    setStatus(session, 'idle')
  } else {
    broadcastStatus({ sessionId: id, status: 'starting' })
    setStatus(session, 'running')
  }

  void consumeStream(session)

  return id
}

export async function sendInput(sessionId: string, text: string): Promise<void> {
  let s = active.get(sessionId)
  if (!s) {
    const persisted = registry.getSession(sessionId)
    if (!persisted?.sdkSessionId) throw new Error(`session ${sessionId} not found`)
    await startSession({
      localId: sessionId,
      projectPath: persisted.projectPath,
      worktreePath: persisted.worktreePath ?? undefined,
      initialPrompt: persisted.initialPrompt,
      model: persisted.model ?? undefined,
      effort: (persisted.effort as import('../shared/ipc-contract').RoleEffort) ?? undefined,
      resumeSdkSessionId: persisted.sdkSessionId,
      roleName: persisted.roleName ?? undefined,
      agencyName: persisted.agencyName ?? undefined,
      agencyInstanceId: persisted.agencyInstanceId ?? undefined,
      roleId: persisted.roleId ?? undefined,
    })
    s = active.get(sessionId)!
  }
  s.input.push(messageFromText(text))
  setStatus(s, 'running')
}

export async function interruptSession(sessionId: string): Promise<void> {
  const s = active.get(sessionId)
  if (!s) return
  s.interrupted = true
  setStatus(s, 'suspended')
  try { s.input.close() } catch { /* ignore */ }
  try { await s.query.interrupt() } catch { /* ignore */ }
  try { s.abortController.abort() } catch { /* ignore */ }
  try { s.query.close?.() } catch { /* ignore */ }
}

export async function terminateSession(sessionId: string): Promise<void> {
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
  setStatus(s, 'terminated')
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

export async function resumeSession(localId: string): Promise<string> {
  const persisted = registry.getSession(localId)
  if (!persisted) throw new Error(`No persisted session found for id "${localId}"`)
  return startSession({
    projectPath: persisted.projectPath,
    worktreePath: persisted.worktreePath ?? undefined,
    initialPrompt: persisted.initialPrompt,
    model: persisted.model ?? undefined,
    effort: (persisted.effort as import('../shared/ipc-contract').RoleEffort) ?? undefined,
    agencyInstanceId: persisted.agencyInstanceId ?? undefined,
    roleId: persisted.roleId ?? undefined,
    roleName: persisted.roleName ?? undefined,
    agencyName: persisted.agencyName ?? undefined,
    resumeSdkSessionId: persisted.sdkSessionId,
  })
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
  workItemId: string | null
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
    workItemId: s.workItemId,
  }))
}
