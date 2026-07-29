import { webContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getHarness } from './harness/index'
import type { HarnessEvent } from '@agentkeeper/core'
import * as costLedger from './cost-ledger'
import { truncateSessionJsonl, restoreSessionJsonl } from './sessions'
import { calculateCost, calculateCostBreakdown } from './pricing'
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
  harnessId: string
  model: string | undefined
  effort: RoleEffort | undefined
  permissionMode: PermissionMode
  stream: AsyncIterable<HarnessEvent>
  input: AsyncQueue<{type:'user';message:{role:'user';content:unknown}}>
  abortController: AbortController
  status: LiveSessionStatus
  startedAt: number
  initialPrompt: string
  workItemId: string | null
  workItemKey: string | null
  workItemTitle: string | null
  /** Full harness event history for orchestrator routing. */
  events: HarnessEvent[]
  /** Last-known TodoWrite todo list, kept in sync during the session. */
  planState: PlanTodo[] | null
  /** Resolvers awaiting next terminal status (idle/suspended/completed/error/inactive). */
  idleWaiters: Array<(status: LiveSessionStatus) => void>
  /** Outstanding background task ids from background_tasks_changed (REPLACE semantics,
   *  empty at startup — the SDK emits no initial snapshot). */
  backgroundTaskIds: Set<string>
  /** True while the stream is held open past a result because background work is
   *  outstanding — the CLI resumes the turn itself when the task completes, but
   *  only if the input stream stays open. */
  backgroundParked: boolean
  backgroundParkTimer: NodeJS.Timeout | null
  interrupted: boolean
  turnCount: number
  mcpFactory?: NonNullable<InternalStartExtras['mcpFactory']>
  additionalMcpServers?: Record<string, ExternalMcpConfig>
  onTerminalError?: () => void
}

/**
 * Plain-object config for an external (non-SDK) MCP server.
 * Matches the stdio / http / sse variants the Agent SDK accepts in mcpServers.
 */
export type ExternalMcpConfig =
  | { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }

/** Optional extras orchestrator passes to startSession that aren't in the
 *  IPC contract (mcpServers is an SDK object, not transportable). */
export interface InternalStartExtras {
  mcpServer?: ReturnType<
    typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
  >
  mcpFactory?: () => ReturnType<
    typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer
  >
  /** External MCP servers (stdio/http/sse) to activate alongside the built-in
   *  agentkeeper server. Keys become the server names visible to the agent. */
  additionalMcpServers?: Record<string, ExternalMcpConfig>
  /** Called once when the stream reaches a terminal error with no reconnect
   *  scheduled, after the active-map entry has been removed. Fired in
   *  consumeStream's finally block so startSession can be called again safely. */
  onTerminalError?: () => void
}

type DefaultMcpFactoryResolver = (args: {
  projectPath: string
  agentLocalId: string
  isAgency: boolean
}) => NonNullable<InternalStartExtras['mcpFactory']>

// Injected by ipc.ts at startup. agent.ts can't import the factories from
// orchestrator.ts directly (orchestrator imports agent — cycle), but every
// session must carry the agentkeeper MCP server even when a resume path
// (sendInput auto-resume, resumeSession, restartIdle, editAndRerun) doesn't
// pass one explicitly.
let defaultMcpFactoryResolver: DefaultMcpFactoryResolver | null = null

export function setDefaultMcpFactoryResolver(fn: DefaultMcpFactoryResolver): void {
  defaultMcpFactoryResolver = fn
}

const active = new Map<string, ActiveSession>()
const restartingIds = new Set<string>()

let mobileNotifier: ((sessionId: string, event: unknown) => void) | null = null
let mobileSessionsNotifier: (() => void) | null = null

export function setMobileEventNotifier(fn: (sessionId: string, event: unknown) => void): void {
  mobileNotifier = fn
}

export function setMobileSessionsNotifier(fn: () => void): void {
  mobileSessionsNotifier = fn
}

// A session can be created by any client (desktop renderer, mobile, agency
// orchestrator). Whoever didn't initiate it has no entry in its list yet, so
// fan a one-shot "created" signal out to every renderer and to mobile.
function broadcastSessionCreated(localId: string): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:created', localId)
  }
  mobileSessionsNotifier?.()
}

registry.setSessionRegisteredNotifier(broadcastSessionCreated)

// Deletes fan out the same way: the desktop renderer drops the row from its
// store, and mobile gets a sessions-list ping to refetch.
function broadcastSessionDeleted(localId: string): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:deleted', localId)
  }
  mobileSessionsNotifier?.()
}

registry.setSessionDeletedNotifier(broadcastSessionDeleted)

interface UndoBuffer {
  projectPath: string
  sdkSessionId: string
  harnessId: string
  keptCount: number
  removedLines: string[]
}
const undoBuffers = new Map<string, UndoBuffer>()
const mcpRestartCounts = new Map<string, number>()

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
  mobileNotifier?.(event.sessionId, payload)
}

export function broadcastStatus(update: LiveSessionStatusUpdate): void {
  const payload = toPlain(update)
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send('session:status', payload)
  }
  mobileSessionsNotifier?.()
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
  'inactive',
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

// Mirror of the SDK's background-task wait ceiling (ovS in the CLI bundle) so a
// task that never completes cannot leak a parked session forever.
const BG_WAIT_CEILING_MS =
  Number(process.env['CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS']) || 600_000

function clearBackgroundPark(session: ActiveSession): void {
  session.backgroundParked = false
  if (session.backgroundParkTimer) {
    clearTimeout(session.backgroundParkTimer)
    session.backgroundParkTimer = null
  }
}

async function consumeStream(session: ActiveSession): Promise<void> {
  let restartScheduled = false
  try {
    for await (const msg of session.stream) {
      if (session.interrupted) break

      session.events.push(msg)

      // The CLI resumes a parked turn on its own after background completion: a
      // synthetic user message (origin task-notification) followed by a fresh
      // assistant turn. Any turn activity means we are no longer waiting.
      if (
        session.backgroundParked &&
        (msg.type === 'user' || msg.type === 'assistant' || msg.type === 'stream_event')
      ) {
        clearBackgroundPark(session)
        setStatus(session, 'running')
      }

      if (msg.type === 'system') {
        const anyMsg = msg as unknown as {
          subtype?: string
          session_id?: string
          tasks?: Array<{ task_id: string }>
        }
        if (anyMsg.subtype === 'background_tasks_changed' && Array.isArray(anyMsg.tasks)) {
          session.backgroundTaskIds = new Set(anyMsg.tasks.map((t) => t.task_id))
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
        // A user message pushed while this result was in flight would be lost
        // if we close the queue now — keep the stream alive for the next turn.
        if (session.input.pendingCount > 0) {
          continue
        }
        // Closing the input queue here would orphan any outstanding background
        // task: the CLI's completion notification needs a live stream to land
        // in. Park instead — status still goes idle/suspended so waitForNextIdle
        // resolves, but the session stays in `active` with the queue open.
        // terminal_reason corroborates because background_tasks_changed ordering
        // vs result is unspecified and the set may not be populated yet.
        const terminalReason = (msg as unknown as { terminal_reason?: string }).terminal_reason
        if (session.backgroundTaskIds.size > 0 || terminalReason === 'background_requested') {
          setStatus(session, session.sessionLocalId !== session.agentLocalId ? 'idle' : 'suspended')
          session.backgroundParked = true
          if (session.backgroundParkTimer) clearTimeout(session.backgroundParkTimer)
          session.backgroundParkTimer = setTimeout(() => {
            if (active.get(session.agentLocalId) !== session || !session.backgroundParked) return
            console.warn(
              `[agent] session ${session.agentLocalId} hit background wait ceiling (${BG_WAIT_CEILING_MS}ms), closing input`,
            )
            try { session.input.close() } catch { /* ignore */ }
          }, BG_WAIT_CEILING_MS)
          continue
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
      const restartCount = mcpRestartCounts.get(session.agentLocalId) ?? 0
      if (session.mcpFactory) {
        mcpRestartCounts.set(session.agentLocalId, restartCount + 1)
        const delayMs = Math.min(Math.pow(2, restartCount) * 500, 30_000)
        console.warn(`[agent] session ${session.agentLocalId} MCP error, reconnecting (attempt ${restartCount + 1}) in ${delayMs}ms:`, err)
        setStatus(session, 'error', `MCP disconnected — reconnecting (attempt ${restartCount + 1})…`)
        restartScheduled = true
        const restartExtras: InternalStartExtras = {
          mcpFactory: session.mcpFactory,
          ...(session.additionalMcpServers ? { additionalMcpServers: session.additionalMcpServers } : {}),
          ...(session.onTerminalError ? { onTerminalError: session.onTerminalError } : {}),
        }
        setTimeout(() => void scheduledMcpRestart(session.agentLocalId, restartExtras), delayMs)
      } else {
        console.error(`[agent] session ${session.agentLocalId} stream error:`, err)
        setStatus(session, 'error', message)
      }
    }
  } finally {
    clearBackgroundPark(session)
    const now = Date.now()
    // Guard against clobbering a replacement session started by editAndRerun.
    // active.delete + sendInput in editAndRerun can race with this finally block:
    // the new ActiveSession may already occupy the same key by the time we land here.
    const isStillOwner = active.get(session.agentLocalId) === session
    if (isStillOwner || !active.has(session.agentLocalId)) {
      // Update agent row in DB.
      registry.updateAgent(session.agentLocalId, {
        status: session.status,
        lastActivityAt: now,
      })
      // Compute session-level status rollup from all agents.
      const allAgents = registry.listAgentsBySession(session.sessionLocalId)
        .map((a): Agent => {
          if (a.localId === session.agentLocalId) return { ...a, status: session.status }
          const live = active.get(a.localId)
          return live ? { ...a, status: live.status } : a
        })
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
    }
    if (session.status === 'completed' || session.status === 'idle') {
      mcpRestartCounts.delete(session.agentLocalId)
    }
    if (isStillOwner) {
      active.delete(session.agentLocalId)
    }
    // Fire AFTER active.delete so the orchestrator's retry path can reinstate
    // a clean session without racing the old entry. Skipped when a reconnect
    // is scheduled — firing both would double-restart the agent.
    if (session.status === 'error' && !session.interrupted && !restartScheduled) {
      session.onTerminalError?.()
    }
  }
}

// Inlining a whole text file into the prompt blows the context window for large
// files (e.g. an attached HTML page). Past this size we spill the file to disk
// under the session cwd and hand the agent a path to Read on demand instead.
const ATTACHMENT_INLINE_LIMIT = 8_000

async function messageFromInput(
  text: string,
  attachments?: Attachment[],
  cwd?: string,
): Promise<{type:'user';message:{role:'user';content:unknown}}> {
  if (!attachments || attachments.length === 0) {
    return { type: 'user', message: { role: 'user', content: text } }
  }
  const blocks: unknown[] = []
  for (const a of attachments) {
    if (a.mimeType.startsWith('image/')) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: a.mimeType, data: a.content },
      })
      continue
    }
    if (a.content.length > ATTACHMENT_INLINE_LIMIT && cwd) {
      const savedPath = await spillAttachment(a, cwd)
      blocks.push({
        type: 'text',
        text: `User attached file "${a.name}" (${a.content.length} chars, too large to inline). Saved to ${savedPath} — use the Read tool to read it.`,
      })
      continue
    }
    blocks.push({ type: 'text', text: `<file name="${a.name}">\n${a.content}\n</file>` })
  }
  if (text.trim()) blocks.push({ type: 'text', text })
  return { type: 'user', message: { role: 'user', content: blocks } }
}

async function spillAttachment(a: Attachment, cwd: string): Promise<string> {
  const dir = path.join(cwd, '.agentkeeper', 'attachments')
  await mkdir(dir, { recursive: true })
  const safeName = a.name.replace(/[^\w.-]/g, '_')
  const filePath = path.join(dir, `${randomUUID().slice(0, 8)}-${safeName}`)
  await writeFile(filePath, a.content, 'utf-8')
  return filePath
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

  // Pin the harness for this session: explicit param > the harness the session
  // already ran on (resume) > the active harness. Routing later JSONL reads and
  // message-uuid lookups through this id keeps them correct even if the active
  // harness changes.
  const harnessId =
    params.harnessId ?? registry.getSession(sessionLocalId)?.harnessId ?? getHarness().id

  const controller = new AbortController()
  const input = new AsyncQueue<{type:'user';message:{role:'user';content:unknown}}>()
  const isResume = !!params.resumeSdkSessionId
  const cwd = params.worktreePath ?? params.projectPath
  const initialUserMsg = isResume
    ? null
    : await messageFromInput(params.initialPrompt, params.initialAttachments, cwd)
  if (initialUserMsg) {
    input.push(initialUserMsg)
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
      harnessId,
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
      lastUserMessageAt: null,
      planState: null,
    })
  }

  // Register agent row upfront (solo: isEntryPoint=true; agency: caller sets isEntryPoint).
  // Skip re-registration for existing agents (editAndRerun / sendInput auto-resume) to avoid
  // zeroing out the stored sdkSessionId before the new one arrives via system/init.
  if (registry.getAgent(agentLocalId) == null) {
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
  } else {
    registry.updateAgent(agentLocalId, { status: 'starting', lastActivityAt: now })
  }

  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
  }
  if (apiKey) {
    childEnv['ANTHROPIC_API_KEY'] = apiKey
  }

  // Resolve the agentkeeper MCP server for this session. Resume paths don't
  // pass a factory, so fall back to the injected default — otherwise a resumed
  // agent silently loses plan tools and send_message.
  const isAgency = !!(params.agencyId ?? registry.getSession(sessionLocalId)?.agencyId)
  const mcpFactory =
    extras.mcpFactory ??
    defaultMcpFactoryResolver?.({ projectPath: params.projectPath, agentLocalId, isAgency })
  const mcpServer = extras.mcpServer ?? mcpFactory?.()
  const hasBuiltin = !!mcpServer
  const hasExternal = extras.additionalMcpServers && Object.keys(extras.additionalMcpServers).length > 0

  const stream = getHarness(harnessId).runSession('', {
    model: params.model,
    cwd,
    ...(systemPromptAppend
      ? { preset: 'claude_code', systemPrompt: systemPromptAppend }
      : isResume ? {}
      : { preset: 'claude_code' }),
    env: childEnv as Record<string, string>,
    messageQueue: input,
    ...(params.resumeSdkSessionId ? { resume: params.resumeSdkSessionId } : {}),
    ...(params.effort ? { effort: params.effort } : {}),
    abortController: controller,
    permissionMode: params.permissionMode ?? 'bypassPermissions',
    settingSources: ['user', 'project'],
    includePartialMessages: true,
    ...(params.allowedTools?.length ? { allowedTools: params.allowedTools } : {}),
    ...(hasBuiltin || hasExternal ? { mcpServers: { ...(hasBuiltin ? { agentkeeper: mcpServer! } : {}), ...(extras.additionalMcpServers ?? {}) } } : {}),
  })

  const session: ActiveSession = {
    id: agentLocalId,
    agentLocalId,
    sessionLocalId,
    sdkSessionId: null,
    projectPath: params.projectPath,
    worktreePath: params.worktreePath,
    harnessId,
    model: params.model,
    effort: params.effort,
    permissionMode: params.permissionMode ?? 'bypassPermissions',
    stream,
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
    backgroundTaskIds: new Set(),
    backgroundParked: false,
    backgroundParkTimer: null,
    interrupted: false,
    turnCount: costLedger.getAgentTurnCount(agentLocalId),
    mcpFactory,
    additionalMcpServers: extras.additionalMcpServers,
    onTerminalError: extras.onTerminalError,
  }

  active.set(agentLocalId, session)
  broadcastStatus({ sessionId: sessionLocalId, agentLocalId, status: 'starting' })
  // A resume with nothing queued spawns a subprocess that just waits for
  // input — reporting 'running' there leaves phantom-running agents in the UI.
  const resumedWaiting = isResume && input.pendingCount === 0
  setStatus(
    session,
    resumedWaiting ? (sessionLocalId !== agentLocalId ? 'idle' : 'suspended') : 'running',
  )

  if (!isResume) {
    broadcastEvent({
      sessionId: sessionLocalId,
      agentLocalId,
      message: initialUserMsg!,
      isEntryPoint: params.isEntryPoint ?? isNewSession,
    })
  }

  void consumeStream(session)

  return agentLocalId
}

export async function sendInput(sessionId: string, text: string, attachments?: Attachment[]): Promise<void> {
  let s = active.get(sessionId)
  // Turn-end race: the result handler closes the input queue before the
  // finally block removes the session from `active`. Pushing into a closed
  // queue is a silent no-op, so treat this session as inactive and resume.
  if (s?.input.isClosed) {
    s = undefined
  }
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
  const userMsg = await messageFromInput(text, attachments, s.worktreePath ?? s.projectPath)
  broadcastEvent({ sessionId: s.sessionLocalId, agentLocalId: s.agentLocalId, message: userMsg })
  s.input.push(userMsg)
  // A parked session's ceiling timer must not fire mid-turn after a manual resume.
  clearBackgroundPark(s)
  setStatus(s, 'running')
}

export async function interruptSession(sessionId: string): Promise<boolean> {
  const targets = [...active.values()].filter(
    s => s.agentLocalId === sessionId || s.sessionLocalId === sessionId
  )
  if (targets.length === 0) return false
  await Promise.all(targets.map(async s => {
    s.interrupted = true
    setStatus(s, 'suspended')
    try { s.input.close() } catch { /* ignore */ }
    try { s.abortController.abort() } catch { /* ignore */ }
  }))
  return true
}

export async function terminateSession(sessionId: string): Promise<void> {
  const targets = [...active.values()].filter(
    s => s.agentLocalId === sessionId || s.sessionLocalId === sessionId
  )
  await Promise.all(targets.map(async s => {
    try { s.input.close() } catch { /* ignore */ }
    try { s.abortController.abort() } catch { /* ignore */ }
    setStatus(s, 'inactive')
    active.delete(s.agentLocalId)
  }))
}

export function isSessionActive(sessionId: string): boolean {
  return active.has(sessionId)
}

export function getActiveSession(sessionId: string): ActiveSession | null {
  return active.get(sessionId) ?? null
}

export function getActiveSessionsBySessionLocalId(sessionLocalId: string): ActiveSession[] {
  return [...active.values()].filter(
    s => s.sessionLocalId === sessionLocalId || s.agentLocalId === sessionLocalId
  )
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

export function setAgentStatus(sessionId: string, status: LiveSessionStatus): void {
  const s = active.get(sessionId)
  if (!s) return
  setStatus(s, status)
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

async function scheduledMcpRestart(
  agentLocalId: string,
  extras: InternalStartExtras,
): Promise<void> {
  if (restartingIds.has(agentLocalId)) return
  restartingIds.add(agentLocalId)
  try {
    const agent = registry.getAgent(agentLocalId)
    const persistedSession = registry.getSession(agent?.sessionLocalId ?? agentLocalId)
    if (!persistedSession || !agent?.sdkSessionId) return
    await startSession(
      {
        localId: agentLocalId,
        agentLocalId,
        sessionLocalId: agent.sessionLocalId !== agentLocalId ? agent.sessionLocalId : undefined,
        projectPath: persistedSession.projectPath,
        worktreePath: persistedSession.worktreePath ?? undefined,
        initialPrompt: persistedSession.initialPrompt,
        model: persistedSession.model ?? undefined,
        effort: (persistedSession.effort as RoleEffort) ?? undefined,
        permissionMode: (persistedSession.permissionMode as PermissionMode) ?? undefined,
        resumeSdkSessionId: agent.sdkSessionId,
        roleId: agent.roleId ?? undefined,
        roleName: agent.roleName ?? undefined,
        agencyName: persistedSession.agencyName ?? undefined,
        agencyId: persistedSession.agencyId ?? undefined,
        agencyScope: (persistedSession.agencyScope as AgencyScope) ?? undefined,
        isEntryPoint: agent.isEntryPoint,
      },
      extras,
    )
  } catch (err) {
    console.error(`[agent] MCP restart failed for ${agentLocalId}:`, err)
  } finally {
    restartingIds.delete(agentLocalId)
  }
}

export async function reconnectSessionMcp(
  agentLocalId: string,
  mcpFactory: NonNullable<InternalStartExtras['mcpFactory']>,
): Promise<void> {
  mcpRestartCounts.delete(agentLocalId)
  await scheduledMcpRestart(agentLocalId, { mcpFactory })
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
    if (currentStatus === 'error' || currentStatus === 'completed') {
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

export async function editAndRerun(
  agentLocalId: string,
  truncateFromUuid: string,
  newText: string,
  originalText?: string | null,
): Promise<void> {
  const agent = registry.getAgent(agentLocalId)
  if (!agent?.sdkSessionId) throw new Error(`agent ${agentLocalId} has no sdkSessionId`)
  const session = registry.getSession(agent.sessionLocalId)
  if (!session) throw new Error(`session not found for agent ${agentLocalId}`)
  await interruptSession(agentLocalId)
  active.delete(agentLocalId)
  const { keptCount, removedLines, keptHasConversation } = await truncateSessionJsonl(
    session.projectPath,
    agent.sdkSessionId,
    truncateFromUuid,
    originalText,
    session.harnessId,
  )
  undoBuffers.set(agentLocalId, {
    projectPath: session.projectPath,
    sdkSessionId: agent.sdkSessionId,
    harnessId: session.harnessId ?? getHarness().id,
    keptCount,
    removedLines,
  })
  if (keptHasConversation) {
    // Prior turns survive — resume so the model keeps the truncated context.
    await sendInput(agentLocalId, newText)
    return
  }
  // Editing the first message leaves no conversation to resume from; the
  // truncated file is only meta lines and `claude --resume` produces nothing.
  // Start a fresh session (new sdkSessionId) with the edited text as the prompt.
  await startSession({
    localId: agentLocalId,
    agentLocalId,
    sessionLocalId: agent.sessionLocalId !== agentLocalId ? agent.sessionLocalId : undefined,
    projectPath: session.projectPath,
    worktreePath: session.worktreePath ?? undefined,
    initialPrompt: newText,
    model: session.model ?? undefined,
    effort: session.effort ?? undefined,
    permissionMode: (session.permissionMode as PermissionMode) ?? undefined,
    harnessId: session.harnessId,
    roleId: agent.roleId ?? undefined,
    roleName: agent.roleName ?? undefined,
    agencyName: session.agencyName ?? undefined,
    agencyId: session.agencyId ?? undefined,
    agencyScope: session.agencyScope ?? undefined,
    isEntryPoint: agent.isEntryPoint,
  })
}

export async function undoEditAndRerun(agentLocalId: string): Promise<void> {
  const buf = undoBuffers.get(agentLocalId)
  if (!buf) return
  undoBuffers.delete(agentLocalId)
  await interruptSession(agentLocalId)
  active.delete(agentLocalId)
  await restoreSessionJsonl(buf.projectPath, buf.sdkSessionId, buf.keptCount, buf.removedLines, buf.harnessId)
  // A fresh-start edit (first-message case) forks agent.sdkSessionId to a new
  // file; repoint it at the restored original so reload reads the right one.
  registry.updateAgent(agentLocalId, { sdkSessionId: buf.sdkSessionId })
}
