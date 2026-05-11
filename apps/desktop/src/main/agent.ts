import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  query,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import * as costLedger from './cost-ledger'
import { calculateCost, calculateCostBreakdown } from './pricing'
import { getPersistedTurnCount } from './stats'
import type {
  AgencyScope,
  Attachment,
  LiveSessionEvent,
  LiveSessionStats,
  LiveSessionStatus,
  LiveSessionStatusUpdate,
  PermissionMode,
  RoleEffort,
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
  effort: RoleEffort | undefined
  permissionMode: PermissionMode
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
  agencyId: string | null
  agencyScope: AgencyScope | null
  roleId: string | null
  roleInstanceIndex: number | null
  workItemId: string | null
  workItemKey: string | null
  workItemTitle: string | null
  /** Full SDK message history for orchestrator routing. */
  events: SDKMessage[]
  /** Resolvers awaiting next terminal status (idle/suspended/completed/error/terminated). */
  idleWaiters: Array<(status: LiveSessionStatus) => void>
  interrupted: boolean
  turnCount: number
}

/** Optional extras orchestrator passes to startSession that aren't in the
 *  IPC contract (mcpServers is an SDK object, not transportable). */
export interface InternalStartExtras {
  mcpServer?: ReturnType<
    typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
  >
}

const active = new Map<string, ActiveSession>()
const restartingIds = new Set<string>()

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

export function broadcastStatus(update: LiveSessionStatusUpdate): void {
  const payload = toPlain(update)
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:status', payload)
  }
}

function broadcastStats(stats: LiveSessionStats): void {
  const payload = toPlain(stats)
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:stats', payload)
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
            effort: session.effort ?? null,
            permissionMode: session.permissionMode,
            initialPrompt: session.initialPrompt,
            roleName: session.roleName,
            roleId: session.roleId,
            agencyInstanceId: session.agencyInstanceId,
            agencyName: session.agencyName,
            agencyId: session.agencyId,
            agencyScope: session.agencyScope,
            startedAt: session.startedAt,
            lastActivityAt: Date.now(),
            status: session.status,
            workItemKey: session.workItemKey,
            workItemTitle: session.workItemTitle,
            title: null,
          }, session.roleInstanceIndex ?? undefined)
        }
      }

      broadcastEvent({ sessionId: session.id, message: msg })

      if (msg.type === 'result') {
        const resultMsg = msg as unknown as {
          usage?: {
            input_tokens?: number
            output_tokens?: number
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          }
          total_cost_usd?: number
        }
        const u = resultMsg.usage ?? {}
        const tokenUsage = {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
        }
        const perTypeCost = calculateCostBreakdown(tokenUsage, session.model ?? '')
        const sdkCost = resultMsg.total_cost_usd ?? 0
        const totalCostUsd = sdkCost > 0 ? sdkCost : calculateCost(tokenUsage, session.model ?? '')
        broadcastStats({
          activeSessionCount: active.size,
          runningSessionCount: Array.from(active.values()).filter(
            (s) => s.status === 'running' || s.status === 'starting',
          ).length,
          turnUsage: {
            sessionId: session.id,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            cacheReadInputTokens: tokenUsage.cacheReadTokens,
            cacheCreationInputTokens: tokenUsage.cacheCreationTokens,
            totalCostUsd,
            inputCostUsd: perTypeCost.inputCostUsd,
            outputCostUsd: perTypeCost.outputCostUsd,
            cacheReadCostUsd: perTypeCost.cacheReadCostUsd,
            cacheCreationCostUsd: perTypeCost.cacheCreationCostUsd,
          },
        })
        const turnKey = `${session.id}:turn:${session.turnCount}`
        session.turnCount++
        if (!costLedger.hasEntry(turnKey)) {
          const _now = new Date()
          costLedger.recordEntry({
            key: turnKey,
            date: `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`,
            model: session.model ?? 'unknown',
            ...tokenUsage,
            inputCostUsd: perTypeCost.inputCostUsd,
            outputCostUsd: perTypeCost.outputCostUsd,
            cacheReadCostUsd: perTypeCost.cacheReadCostUsd,
            cacheCreationCostUsd: perTypeCost.cacheCreationCostUsd,
            costUsd: totalCostUsd,
            recordedAt: new Date().toISOString(),
          })
        }
        // Agency members signal 'idle' so routeMessage's waitForNextIdle
        // resolves and can capture the reply text, then we still close and
        // break — the subprocess is re-spawned lazily on the next
        // send_message call rather than held alive between turns.
        setStatus(session, session.agencyInstanceId ? 'idle' : 'suspended')
        try { session.input.close() } catch { /* ignore */ }
        break
      }
    }
    if (session.status !== 'suspended' && session.status !== 'idle') {
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

function messageFromInput(text: string, attachments?: Attachment[]): SDKUserMessage {
  if (!attachments || attachments.length === 0) {
    return { type: 'user', message: { role: 'user', content: text } } as SDKUserMessage
  }
  const blocks: unknown[] = attachments.map((a) => {
    if (a.mimeType.startsWith('image/')) {
      return {
        type: 'image',
        source: { type: 'base64', media_type: a.mimeType, data: a.content },
      }
    }
    return { type: 'text', text: `<file name="${a.name}">\n${a.content}\n</file>` }
  })
  if (text.trim()) blocks.push({ type: 'text', text })
  return { type: 'user', message: { role: 'user', content: blocks } } as SDKUserMessage
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
    input.push(messageFromInput(params.initialPrompt, params.initialAttachments))
  }

  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
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
    permissionMode: params.permissionMode ?? 'bypassPermissions',
    settingSources: ['user', 'project'],
    includePartialMessages: true,
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
    options!.mcpServers = { agentkeeper: extras.mcpServer }
  }

  const q = query({ prompt: input, options })

  const session: ActiveSession = {
    id,
    sdkSessionId: null,
    projectPath: params.projectPath,
    worktreePath: params.worktreePath,
    model: params.model,
    effort: params.effort,
    permissionMode: params.permissionMode ?? 'bypassPermissions',
    query: q,
    input,
    abortController: controller,
    status: 'starting',
    startedAt: Date.now(),
    initialPrompt: params.initialPrompt,
    roleName: params.roleName ?? null,
    agencyName: params.agencyName ?? null,
    agencyInstanceId: params.agencyInstanceId ?? null,
    agencyId: params.agencyId ?? null,
    agencyScope: params.agencyScope ?? null,
    roleId: params.roleId ?? null,
    roleInstanceIndex: params.roleInstanceIndex ?? null,
    workItemId: params.workItemId ?? null,
    workItemKey: params.workItemKey ?? null,
    workItemTitle: params.workItemTitle ?? null,
    events: [],
    idleWaiters: [],
    interrupted: false,
    turnCount: getPersistedTurnCount(id),
  }

  active.set(id, session)
  if (isResume) {
    broadcastStatus({ sessionId: id, status: 'starting' })
    setStatus(session, 'idle')
  } else {
    broadcastStatus({ sessionId: id, status: 'starting' })
    setStatus(session, 'running')
  }

  if (!isResume) {
    broadcastEvent({ sessionId: id, message: messageFromInput(params.initialPrompt, params.initialAttachments) })
  }

  void consumeStream(session)

  return id
}

export async function sendInput(sessionId: string, text: string, attachments?: Attachment[]): Promise<void> {
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
      effort: persisted.effort ?? undefined,
      permissionMode: (persisted.permissionMode as PermissionMode) ?? undefined,
      resumeSdkSessionId: persisted.sdkSessionId,
      roleName: persisted.roleName ?? undefined,
      agencyName: persisted.agencyName ?? undefined,
      agencyInstanceId: persisted.agencyInstanceId ?? undefined,
      roleId: persisted.roleId ?? undefined,
    })
    s = active.get(sessionId)!
  }
  const userMsg = messageFromInput(text, attachments)
  broadcastEvent({ sessionId: s.id, message: userMsg })
  s.input.push(userMsg)
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
    effort: persisted.effort ?? undefined,
    permissionMode: (persisted.permissionMode as PermissionMode) ?? undefined,
    agencyInstanceId: persisted.agencyInstanceId ?? undefined,
    roleId: persisted.roleId ?? undefined,
    roleName: persisted.roleName ?? undefined,
    agencyName: persisted.agencyName ?? undefined,
    resumeSdkSessionId: persisted.sdkSessionId ?? undefined,
  })
}

async function restartIdle(
  localId: string,
  overrides: { model?: string; effort?: RoleEffort; permissionMode?: PermissionMode },
): Promise<void> {
  if (restartingIds.has(localId)) throw new Error(`Session ${localId} is already restarting`)
  restartingIds.add(localId)
  try {
    const persisted = registry.getSession(localId)
    if (!persisted) throw new Error(`session ${localId} not found`)

    const s = active.get(localId)
    const currentStatus = s?.status ?? persisted.status
    if (currentStatus === 'running' || currentStatus === 'starting') {
      throw new Error(`cannot change session params while status is ${currentStatus}`)
    }
    if (
      currentStatus === 'terminated' ||
      currentStatus === 'error' ||
      currentStatus === 'completed'
    ) {
      throw new Error(`cannot change session params on a ${currentStatus} session`)
    }

    if (s) {
      try { s.input.close() } catch { /* ignore */ }
      try { s.abortController.abort() } catch { /* ignore */ }
      if ('model' in overrides) s.model = overrides.model
      if ('effort' in overrides) s.effort = overrides.effort
    }

    const newModel = overrides.model ?? persisted.model ?? undefined
    const newEffort = (overrides.effort ?? persisted.effort) as RoleEffort | undefined
    const newPermissionMode = (overrides.permissionMode ?? persisted.permissionMode ?? undefined) as PermissionMode | undefined
    registry.updateSession(localId, { model: newModel ?? null, effort: newEffort ?? null, permissionMode: newPermissionMode ?? null })

    await startSession({
      localId,
      projectPath: persisted.projectPath,
      worktreePath: persisted.worktreePath ?? undefined,
      initialPrompt: persisted.initialPrompt,
      model: newModel,
      effort: newEffort,
      permissionMode: newPermissionMode,
      resumeSdkSessionId: persisted.sdkSessionId ?? undefined,
      roleName: persisted.roleName ?? undefined,
      agencyName: persisted.agencyName ?? undefined,
      agencyInstanceId: persisted.agencyInstanceId ?? undefined,
      roleId: persisted.roleId ?? undefined,
    })
  } finally {
    restartingIds.delete(localId)
  }
}

export async function setModel(localId: string, model: string): Promise<void> {
  return restartIdle(localId, { model })
}

export async function setEffort(localId: string, effort: RoleEffort): Promise<void> {
  return restartIdle(localId, { effort })
}

export async function setPermissionMode(localId: string, permissionMode: PermissionMode): Promise<void> {
  return restartIdle(localId, { permissionMode })
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
