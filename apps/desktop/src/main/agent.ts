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
  Agent,
  AgencyScope,
  Attachment,
  LiveSessionEvent,
  LiveSessionStats,
  LiveSessionStatus,
  LiveSessionStatusUpdate,
  PermissionMode,
  PlanTodo,
  RoleEffort,
  Session,
  StartSessionParams,
} from '../shared/ipc-contract'
import { AsyncQueue } from './async-queue'
import { secrets, SECRET_KEYS } from './secrets'
import type { WorkItemRegistryFull } from './plugins'
import * as registry from './session-registry'

export interface ActiveSession {
  /** Agent UUID — also the key in the `active` map. Equals sessionLocalId for solo sessions. */
  id: string
  agentLocalId: string
  /** Session UUID. Equals id for solo sessions; the shared instance UUID for agency agents. */
  sessionLocalId: string
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
  workItemId: string | null
  workItemKey: string | null
  workItemTitle: string | null
  /** Full SDK message history for orchestrator routing. */
  events: SDKMessage[]
  /** Last-known TodoWrite todo list, kept in sync during the session. */
  planState: PlanTodo[] | null
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
  broadcastStatus({
    sessionId: s.sessionLocalId,
    agentLocalId: s.agentLocalId,
    status,
    ...(error ? { error } : {}),
  })
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
          registry.updateAgent(session.agentLocalId, { sdkSessionId: anyMsg.session_id })
          broadcastStatus({
            sessionId: session.sessionLocalId,
            agentLocalId: session.agentLocalId,
            status: session.status,
            sdkSessionId: anyMsg.session_id,
          })
        }
      }

      broadcastEvent({
        sessionId: session.sessionLocalId,
        agentLocalId: session.agentLocalId,
        message: msg,
      })

      // Persist latest TodoWrite state so plan progress survives restarts.
      const rawMsg = msg as unknown as Record<string, unknown>
      if (rawMsg['type'] === 'assistant') {
        const content = (rawMsg['message'] as Record<string, unknown> | undefined)?.['content'] as unknown[] | undefined
        if (Array.isArray(content)) {
          const todoBlock = content.find((b) => {
            const block = b as Record<string, unknown>
            return block['type'] === 'tool_use' && block['name'] === 'TodoWrite'
          }) as Record<string, unknown> | undefined
          if (todoBlock) {
            const input = todoBlock['input'] as { todos?: unknown[] } | undefined
            if (Array.isArray(input?.todos)) {
              const todos = input!.todos.filter((t): t is PlanTodo => {
                if (typeof t !== 'object' || t === null) return false
                const o = t as Record<string, unknown>
                return typeof o['content'] === 'string' && typeof o['status'] === 'string'
              })
              session.planState = todos
              registry.updateSession(session.sessionLocalId, { planState: todos })
            }
          }
        }
      }

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
            sessionId: session.sessionLocalId,
            agentLocalId: session.agentLocalId,
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
        const turnKey = `${session.agentLocalId}:turn:${session.turnCount}`
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
        // Agency agents signal 'idle' so routeMessage's waitForNextIdle resolves
        // and can capture the reply text, then close — the subprocess is re-spawned
        // lazily on the next send_message call rather than held alive between turns.
        setStatus(session, session.sessionLocalId !== session.agentLocalId ? 'idle' : 'suspended')
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
      console.error(`[agent] session ${session.agentLocalId} stream error:`, err)
      setStatus(session, 'error', message)
    }
  } finally {
    const now = Date.now()
    // Update agent row in DB.
    registry.updateAgent(session.agentLocalId, {
      status: session.status,
      lastActivityAt: now,
    })
    // Compute session-level status rollup from all agents.
    const allAgents = registry.listAgentsBySession(session.sessionLocalId)
      .map((a): Agent => a.localId === session.agentLocalId ? { ...a, status: session.status } : a)
    const sessionStatus = registry.computeSessionStatus(allAgents)
    const sessionUpdate: Partial<Session> = {
      status: sessionStatus,
      lastActivityAt: now,
    }
    if (session.planState) {
      const hasInProgress = session.status !== 'completed' &&
        session.planState.some(t => t.status === 'in_progress')
      sessionUpdate.planState = hasInProgress
        ? session.planState.map(t => t.status === 'in_progress' ? { ...t, status: 'partial' as const } : t)
        : session.planState
    }
    registry.updateSession(session.sessionLocalId, sessionUpdate)
    active.delete(session.agentLocalId)
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

  if (params.resumeSdkSessionId) {
    const prevSession = registry.getSessionBySdkId(params.resumeSdkSessionId)
    if (prevSession?.planState) {
      const incomplete = prevSession.planState.filter(
        (t) => t.status === 'partial' || t.status === 'in_progress',
      )
      if (incomplete.length > 0) {
        const resumeCtx = [
          '\n\n## Resumed session — incomplete steps',
          'Your previous session was interrupted. The following plan steps were not finished:',
          ...incomplete.map((t) => `- ${t.content}`),
          '\nResume from the first incomplete step above.',
        ].join('\n')
        systemPromptAppend = (systemPromptAppend ?? '') + resumeCtx
      }
    }
  }

  const agentLocalId = params.agentLocalId ?? params.localId ?? randomUUID()
  const sessionLocalId = params.sessionLocalId ?? agentLocalId
  const isNewSession = !params.sessionLocalId
  const now = Date.now()

  const controller = new AbortController()
  const input = new AsyncQueue<SDKUserMessage>()
  const isResume = !!params.resumeSdkSessionId
  if (!isResume) {
    input.push(messageFromInput(params.initialPrompt, params.initialAttachments))
  }

  // Register session row upfront (solo sessions only; agency session was registered by orchestrator).
  if (isNewSession) {
    registry.registerSession({
      localId: sessionLocalId,
      projectPath: params.projectPath,
      worktreePath: params.worktreePath ?? null,
      branch: params.worktreePath ? path.basename(params.worktreePath) : null,
      model: params.model ?? null,
      effort: params.effort ?? null,
      permissionMode: params.permissionMode ?? 'bypassPermissions',
      initialPrompt: params.initialPrompt ?? '',
      agencyName: params.agencyName ?? null,
      agencyId: params.agencyId ?? null,
      agencyScope: params.agencyScope ?? null,
      title: null,
      workItemKey: params.workItemKey ?? null,
      workItemTitle: params.workItemTitle ?? null,
      status: 'starting',
      startedAt: now,
      lastActivityAt: now,
      planState: null,
    })
  }

  // Register agent row upfront (solo: isEntryPoint=true; agency: caller sets isEntryPoint).
  registry.registerAgent({
    localId: agentLocalId,
    sessionLocalId,
    sdkSessionId: null,
    roleId: params.roleId ?? null,
    roleName: params.roleName ?? null,
    roleInstanceIndex: params.roleInstanceIndex ?? null,
    initialPrompt: params.initialPrompt ?? '',
    isEntryPoint: params.isEntryPoint ?? isNewSession,
    status: 'starting',
    startedAt: now,
    lastActivityAt: now,
  })

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
    id: agentLocalId,
    agentLocalId,
    sessionLocalId,
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
    startedAt: now,
    initialPrompt: params.initialPrompt,
    workItemId: params.workItemId ?? null,
    workItemKey: params.workItemKey ?? null,
    workItemTitle: params.workItemTitle ?? null,
    events: [],
    planState: null,
    idleWaiters: [],
    interrupted: false,
    turnCount: getPersistedTurnCount(agentLocalId),
  }

  active.set(agentLocalId, session)
  if (isResume) {
    broadcastStatus({ sessionId: sessionLocalId, agentLocalId, status: 'starting' })
    setStatus(session, 'idle')
  } else {
    broadcastStatus({ sessionId: sessionLocalId, agentLocalId, status: 'starting' })
    setStatus(session, 'running')
  }

  if (!isResume) {
    broadcastEvent({
      sessionId: sessionLocalId,
      agentLocalId,
      message: messageFromInput(params.initialPrompt, params.initialAttachments),
    })
  }

  void consumeStream(session)

  return agentLocalId
}

export async function sendInput(sessionId: string, text: string, attachments?: Attachment[]): Promise<void> {
  let s = active.get(sessionId)
  if (!s) {
    const agent = registry.getAgent(sessionId)
    if (!agent?.sdkSessionId) throw new Error(`session ${sessionId} not found`)
    const persistedSession = registry.getSession(agent.sessionLocalId)
    if (!persistedSession) throw new Error(`session data for ${sessionId} not found`)
    await startSession({
      localId: sessionId,
      agentLocalId: sessionId,
      sessionLocalId: agent.sessionLocalId !== sessionId ? agent.sessionLocalId : undefined,
      projectPath: persistedSession.projectPath,
      worktreePath: persistedSession.worktreePath ?? undefined,
      initialPrompt: persistedSession.initialPrompt,
      model: persistedSession.model ?? undefined,
      effort: persistedSession.effort ?? undefined,
      permissionMode: (persistedSession.permissionMode as PermissionMode) ?? undefined,
      resumeSdkSessionId: agent.sdkSessionId,
      roleId: agent.roleId ?? undefined,
      roleName: agent.roleName ?? undefined,
      agencyName: persistedSession.agencyName ?? undefined,
      agencyId: persistedSession.agencyId ?? undefined,
      agencyScope: persistedSession.agencyScope ?? undefined,
      isEntryPoint: agent.isEntryPoint,
    })
    s = active.get(sessionId)!
  }
  const userMsg = messageFromInput(text, attachments)
  broadcastEvent({ sessionId: s.sessionLocalId, agentLocalId: s.agentLocalId, message: userMsg })
  s.input.push(userMsg)
  setStatus(s, 'running')
}

export async function interruptSession(sessionId: string): Promise<boolean> {
  const direct = active.get(sessionId)
  if (direct) {
    direct.interrupted = true
    setStatus(direct, 'suspended')
    try { direct.input.close() } catch { /* ignore */ }
    try { await direct.query.interrupt() } catch { /* ignore */ }
    try { direct.abortController.abort() } catch { /* ignore */ }
    try { direct.query.close?.() } catch { /* ignore */ }
    return true
  }
  // Cascade: sessionId is a sessionLocalId shared by all agency sub-agents
  const siblings = [...active.values()].filter(s => s.sessionLocalId === sessionId)
  if (siblings.length === 0) return false
  await Promise.all(siblings.map(async s => {
    s.interrupted = true
    setStatus(s, 'suspended')
    try { s.input.close() } catch { /* ignore */ }
    try { await s.query.interrupt() } catch { /* ignore */ }
    try { s.abortController.abort() } catch { /* ignore */ }
    try { s.query.close?.() } catch { /* ignore */ }
  }))
  return true
}

export async function terminateSession(sessionId: string): Promise<void> {
  const direct = active.get(sessionId)
  if (direct) {
    try { direct.input.close() } catch { /* ignore */ }
    try { await direct.query.interrupt() } catch { /* ignore */ }
    try { direct.abortController.abort() } catch { /* ignore */ }
    try { direct.query.close?.() } catch { /* ignore */ }
    setStatus(direct, 'terminated')
    active.delete(sessionId)
    return
  }
  // Cascade: sessionId is a sessionLocalId shared by all agency sub-agents
  const siblings = [...active.values()].filter(s => s.sessionLocalId === sessionId)
  await Promise.all(siblings.map(async s => {
    try { s.input.close() } catch { /* ignore */ }
    try { await s.query.interrupt() } catch { /* ignore */ }
    try { s.abortController.abort() } catch { /* ignore */ }
    try { s.query.close?.() } catch { /* ignore */ }
    setStatus(s, 'terminated')
    active.delete(s.agentLocalId)
  }))
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
  const agent = registry.getAgent(localId)
  const persistedSession = registry.getSession(agent?.sessionLocalId ?? localId)
  if (!persistedSession) throw new Error(`No persisted session found for id "${localId}"`)
  return startSession({
    localId,
    agentLocalId: localId,
    sessionLocalId: agent && agent.sessionLocalId !== localId ? agent.sessionLocalId : undefined,
    projectPath: persistedSession.projectPath,
    worktreePath: persistedSession.worktreePath ?? undefined,
    initialPrompt: persistedSession.initialPrompt,
    model: persistedSession.model ?? undefined,
    effort: persistedSession.effort ?? undefined,
    permissionMode: (persistedSession.permissionMode as PermissionMode) ?? undefined,
    agencyName: persistedSession.agencyName ?? undefined,
    agencyId: persistedSession.agencyId ?? undefined,
    agencyScope: persistedSession.agencyScope ?? undefined,
    roleId: agent?.roleId ?? undefined,
    roleName: agent?.roleName ?? undefined,
    resumeSdkSessionId: agent?.sdkSessionId ?? undefined,
    isEntryPoint: agent?.isEntryPoint,
  })
}

async function restartIdle(
  localId: string,
  overrides: { model?: string; effort?: RoleEffort; permissionMode?: PermissionMode },
): Promise<void> {
  if (restartingIds.has(localId)) throw new Error(`Session ${localId} is already restarting`)
  restartingIds.add(localId)
  try {
    const agent = registry.getAgent(localId)
    const persistedSession = registry.getSession(agent?.sessionLocalId ?? localId)
    if (!persistedSession) throw new Error(`session ${localId} not found`)

    const s = active.get(localId)
    const currentStatus = s?.status ?? persistedSession.status
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

    const newModel = overrides.model ?? persistedSession.model ?? undefined
    const newEffort = (overrides.effort ?? persistedSession.effort) as RoleEffort | undefined
    const newPermissionMode = (overrides.permissionMode ?? persistedSession.permissionMode ?? undefined) as PermissionMode | undefined
    registry.updateSession(persistedSession.localId, { model: newModel ?? null, effort: newEffort ?? null, permissionMode: newPermissionMode ?? null })

    await startSession({
      localId,
      agentLocalId: localId,
      sessionLocalId: agent && agent.sessionLocalId !== localId ? agent.sessionLocalId : undefined,
      projectPath: persistedSession.projectPath,
      worktreePath: persistedSession.worktreePath ?? undefined,
      initialPrompt: persistedSession.initialPrompt,
      model: newModel,
      effort: newEffort,
      permissionMode: newPermissionMode,
      resumeSdkSessionId: agent?.sdkSessionId ?? undefined,
      roleName: agent?.roleName ?? undefined,
      roleId: agent?.roleId ?? undefined,
      agencyName: persistedSession.agencyName ?? undefined,
      agencyId: persistedSession.agencyId ?? undefined,
      agencyScope: persistedSession.agencyScope ?? undefined,
      isEntryPoint: agent?.isEntryPoint,
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
  agentLocalId: string
  sessionLocalId: string
  sdkSessionId: string | null
  projectPath: string
  status: LiveSessionStatus
  startedAt: number
  model: string | undefined
  workItemId: string | null
}> {
  return Array.from(active.values()).map((s) => ({
    id: s.id,
    agentLocalId: s.agentLocalId,
    sessionLocalId: s.sessionLocalId,
    sdkSessionId: s.sdkSessionId,
    projectPath: s.projectPath,
    status: s.status,
    startedAt: s.startedAt,
    model: s.model,
    workItemId: s.workItemId,
  }))
}
