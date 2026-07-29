import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import { getHarness } from './harness/index'
import { getDefaultModel } from './models'
import { z } from 'zod'
import type {
  AgencyInstance,
  AgencyInstanceSession,
  AgencyScope,
  OnFailurePolicy,
  RoleEffort,
  RoleSlot,
  StartAgencyParams,
} from '../shared/ipc-contract'
import { listAgencies } from './agencies'
import { listRoles } from './roles'
import { createWorktree } from './worktrees'
import {
  broadcastStatus,
  getActiveSession,
  sendInput,
  setAgentStatus,
  startSession,
  waitForNextIdle,
  interruptSession,
} from './agent'
import * as registry from './session-registry'
import type { Agent, HandoffRecord } from './session-registry'
import { createPlan, updatePlan, getPlanByRef } from './plans'

interface AgencyRoleRestartParams {
  systemPromptAppend: string
  model: string | undefined
  effort: string | undefined
}

interface AgentInstance {
  localId: string
  roleId: string
  instanceIndex: number
  instanceId: string
  isOverflow: boolean
}

/** Backstop so an orchestrator bug degrades to an error string instead of a
 *  permanent hang. Generous — a peer legitimately works for many minutes. */
const SEND_MESSAGE_TIMEOUT_MS =
  Number(process.env['AGENTKEEPER_SEND_MESSAGE_TIMEOUT_MS']) || 15 * 60_000

function timeoutLabel(): string {
  return SEND_MESSAGE_TIMEOUT_MS >= 60_000
    ? `${Math.round(SEND_MESSAGE_TIMEOUT_MS / 60_000)} minutes`
    : `${Math.round(SEND_MESSAGE_TIMEOUT_MS / 1000)} seconds`
}

interface PendingMessage {
  content: string
  resolve: (r: string) => void
  reject: (e: Error) => void
}

interface RuntimeAgency {
  instanceId: string
  agencyId: string
  agencyScope: AgencyScope
  agencyName: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  /** roleId → all spawned instances for this role */
  instancesByRole: Map<string, AgentInstance[]>
  /** localId → instance */
  sessionToInstance: Map<string, AgentInstance>
  /** Sessions currently handling a send_message delivery */
  busySessions: Set<string>
  /** Messages waiting for an idle slot by roleId */
  pendingByRole: Map<string, PendingMessage[]>
  /** Completed-overflow handoff summaries by roleId */
  handoffsByRole: Map<string, HandoffRecord[]>
  /** Config snapshot keyed by roleId */
  roleSlots: Map<string, RoleSlot>
  allowedFlows: Set<string>
  restartParamsByRole: Map<string, AgencyRoleRestartParams>
  /** Retry attempt counts per roleId for onFailure:'retry' slots */
  retryCountByRole: Map<string, number>
}

const instances = new Map<string, RuntimeAgency>()
/** localId → instanceId — global index so createOrchestratorMcp can look up without inst ref */
const sessionToRuntimeId = new Map<string, string>()

const waitingFor = new Map<string, Set<string>>()

function runtimeOfSession(sessionId: string): RuntimeAgency | null {
  const id = sessionToRuntimeId.get(sessionId)
  return id ? (instances.get(id) ?? null) : null
}

function instanceOfSession(runtime: RuntimeAgency, sessionId: string): AgentInstance | null {
  return runtime.sessionToInstance.get(sessionId) ?? null
}

function wouldCycle(from: string, to: string): boolean {
  const visited = new Set<string>()
  const queue = [to]
  while (queue.length > 0) {
    const cursor = queue.shift()!
    if (visited.has(cursor)) continue
    visited.add(cursor)
    const targets = waitingFor.get(cursor)
    if (!targets) continue
    for (const t of targets) {
      if (t === from) return true
      queue.push(t)
    }
  }
  return false
}

function addWait(from: string, to: string): void {
  let set = waitingFor.get(from)
  if (!set) { set = new Set(); waitingFor.set(from, set) }
  set.add(to)
}

function removeWait(from: string, to: string): void {
  const set = waitingFor.get(from)
  if (!set) return
  set.delete(to)
  if (set.size === 0) waitingFor.delete(from)
}

function idleInstance(runtime: RuntimeAgency, roleId: string): AgentInstance | null {
  const list = runtime.instancesByRole.get(roleId) ?? []
  return list.find((i) => !runtime.busySessions.has(i.localId)) ?? null
}

const instanceIdPattern = /^(.+)-(\d+)$/

/** Check whether a flow from fromInstance/fromRole → toTarget is permitted.
 *  Checks four key combinations so instance-level, role-level, and mixed
 *  flow entries all resolve correctly.
 *  openMessaging on the target role bypasses the flow restriction for inbound
 *  messages — the target accepts messages from any sender. */
function isFlowAllowed(
  runtime: RuntimeAgency,
  fromInstanceId: string,
  fromRoleId: string,
  toTarget: string,
  toRoleId: string,
): boolean {
  if (runtime.allowedFlows.size === 0) return true
  if (runtime.roleSlots.get(toRoleId)?.openMessaging) return true
  return (
    runtime.allowedFlows.has(`${fromInstanceId}->${toTarget}`) ||
    runtime.allowedFlows.has(`${fromRoleId}->${toTarget}`) ||
    runtime.allowedFlows.has(`${fromInstanceId}->${toRoleId}`) ||
    runtime.allowedFlows.has(`${fromRoleId}->${toRoleId}`)
  )
}

/** Compute the list of peer IDs this instance is allowed to send_message to.
 *  Returns null when flows are empty (any-to-any). */
function computeAllowedPeerIds(
  fromInstanceId: string,
  fromRoleId: string,
  allInstanceIds: string[],
  allRoleIds: string[],
  allowedFlows: Set<string>,
): string[] | null {
  if (allowedFlows.size === 0) return null
  const permitted: string[] = []
  for (const target of [...allInstanceIds, ...allRoleIds]) {
    if (target === fromInstanceId || target === fromRoleId) continue
    const m = instanceIdPattern.exec(target)
    const targetRoleId = m ? m[1]! : target
    if (
      allowedFlows.has(`${fromInstanceId}->${target}`) ||
      allowedFlows.has(`${fromRoleId}->${target}`) ||
      allowedFlows.has(`${fromInstanceId}->${targetRoleId}`) ||
      allowedFlows.has(`${fromRoleId}->${targetRoleId}`)
    ) {
      permitted.push(target)
    }
  }
  return permitted
}

async function spawnOverflow(
  runtime: RuntimeAgency,
  roleId: string,
  rolesById: Map<string, { name: string; model: string | null; effort: string | null; systemPrompt: string }>,
  allInstanceIds: string[],
): Promise<AgentInstance> {
  const existing = runtime.instancesByRole.get(roleId) ?? []
  const nextIndex = existing.length + 1
  const instanceId = `${roleId}-${nextIndex}`
  const localId = randomUUID()
  const role = rolesById.get(roleId)!
  const restart = runtime.restartParamsByRole.get(roleId)!
  const slot = runtime.roleSlots.get(roleId)!

  const priorHandoffs = runtime.handoffsByRole.get(roleId) ?? []
  const handoffLines =
    priorHandoffs.length > 0
      ? [
          '',
          `Prior work by previous ${role.name} agents:`,
          ...priorHandoffs.map((h) => `[Instance ${h.instanceIndex}]: ${h.summary}`),
        ].join('\n')
      : ''

  const allRoleIds = [...runtime.roleSlots.keys()]
  const allowedPeerIds = computeAllowedPeerIds(
    instanceId, roleId, allInstanceIds, allRoleIds, runtime.allowedFlows,
  )
  const contextPreamble = buildContextPreamble({
    roleName: role.name,
    roleId,
    instanceIndex: nextIndex,
    totalInstances: slot.max ?? nextIndex,
    instanceId,
    agencyName: runtime.agencyName,
    allInstanceIds,
    isEntry: false,
    handoffLines,
    allowedPeerIds,
  })

  const systemPromptAppend = `${contextPreamble}\n\n${role.systemPrompt}`

  const inst: AgentInstance = {
    localId,
    roleId,
    instanceIndex: nextIndex,
    instanceId,
    isOverflow: true,
  }

  // Reserve the slot synchronously before the first await so concurrent
  // spawnOverflow calls compute distinct nextIndex values and never exceed max.
  // busySessions keeps idleInstance from routing to this slot until startSession
  // completes; deliverToInstance re-adds it and manages the lifecycle from there.
  if (!runtime.instancesByRole.has(roleId)) runtime.instancesByRole.set(roleId, [])
  runtime.instancesByRole.get(roleId)!.push(inst)
  runtime.sessionToInstance.set(localId, inst)
  sessionToRuntimeId.set(localId, runtime.instanceId)
  runtime.busySessions.add(localId)

  try {
    await startSession(
      {
        localId,
        agentLocalId: localId,
        sessionLocalId: runtime.instanceId,
        projectPath: runtime.projectPath,
        ...(runtime.worktreePath ? { worktreePath: runtime.worktreePath } : {}),
        initialPrompt: `Agency "${runtime.agencyName}" overflow agent initialized. Await messages from peers.`,
        systemPromptAppend,
        ...(restart.model ? { model: restart.model } : {}),
        ...(restart.effort ? { effort: restart.effort as RoleEffort } : {}),
        agencyId: runtime.agencyId,
        agencyScope: runtime.agencyScope,
        roleId,
        roleInstanceIndex: nextIndex,
        roleName: role.name,
        agencyName: runtime.agencyName,
        isEntryPoint: false,
      },
      {
        mcpFactory: () => createOrchestratorMcp(runtime.projectPath, localId),
        onTerminalError: () => handleAgentFailure(
          runtime, roleId, localId,
          runtime.roleSlots.get(roleId)?.onFailure ?? 'continue',
        ),
      },
    )
  } catch (err) {
    // Roll back the reservation so the slot doesn't appear permanently occupied.
    const list = runtime.instancesByRole.get(roleId)
    if (list) {
      const idx = list.indexOf(inst)
      if (idx >= 0) list.splice(idx, 1)
    }
    runtime.sessionToInstance.delete(localId)
    sessionToRuntimeId.delete(localId)
    runtime.busySessions.delete(localId)
    throw err
  }

  // Release the hold — deliverToInstance will re-add and manage from here.
  runtime.busySessions.delete(localId)

  return inst
}

async function requestHandoffAndSuspend(
  runtime: RuntimeAgency,
  inst: AgentInstance,
): Promise<void> {
  const handoffPrompt = [
    'You have completed your task. Before suspending, produce a concise handoff summary:',
    'what you built or changed, key decisions and the reasoning behind them, files modified,',
    'any caveats or unresolved issues a developer continuing this work should know.',
    'Be complete enough that another developer can pick this up cold.',
  ].join(' ')

  let summary = ''
  try {
    const target = getActiveSession(inst.localId)
    if (target) {
      const beforeCount = target.events.length
      await sendInput(inst.localId, handoffPrompt)
      await waitForNextIdle(inst.localId)
      const newEvents = target.events.slice(beforeCount)
      const parts: string[] = []
      for (const msg of newEvents) {
        const m = msg as unknown as { type?: string; message?: { content?: unknown } }
        if (m.type !== 'assistant') continue
        const inner = m.message?.content
        if (!Array.isArray(inner)) continue
        for (const block of inner) {
          if (
            block &&
            typeof block === 'object' &&
            (block as Record<string, unknown>)['type'] === 'text' &&
            typeof (block as Record<string, unknown>)['text'] === 'string'
          ) {
            parts.push((block as Record<string, unknown>)['text'] as string)
          }
        }
      }
      summary = parts.join('\n\n').trim()
    }
  } catch {
    summary = '(handoff summary unavailable)'
  }

  const record: HandoffRecord = {
    instanceIndex: inst.instanceIndex,
    summary: summary || '(no summary provided)',
    timestamp: Date.now(),
  }

  if (!runtime.handoffsByRole.has(inst.roleId)) runtime.handoffsByRole.set(inst.roleId, [])
  runtime.handoffsByRole.get(inst.roleId)!.push(record)

  registry.addHandoff(runtime.instanceId, inst.roleId, inst.instanceIndex, record.summary)

  try {
    await interruptSession(inst.localId)
  } catch {
    // already gone
  }
}

function drainPendingForRole(runtime: RuntimeAgency, roleId: string): void {
  const queue = runtime.pendingByRole.get(roleId)
  if (!queue || queue.length === 0) return
  const idle = idleInstance(runtime, roleId)
  if (!idle) return
  const next = queue.shift()!
  void deliverToInstance(runtime, idle, next.content).then(next.resolve).catch(next.reject)
}

async function deliverToInstance(
  runtime: RuntimeAgency,
  inst: AgentInstance,
  content: string,
): Promise<string> {
  runtime.busySessions.add(inst.localId)
  try {
    return await injectAndWait(runtime, inst, content)
  } finally {
    runtime.busySessions.delete(inst.localId)
    if (inst.isOverflow) {
      await requestHandoffAndSuspend(runtime, inst)
    } else {
      drainPendingForRole(runtime, inst.roleId)
    }
  }
}

async function injectAndWait(
  runtime: RuntimeAgency,
  inst: AgentInstance,
  content: string,
): Promise<string> {
  const toSessionId = inst.localId

  let target = getActiveSession(toSessionId)
  if (!target) {
    const persistedAgent = registry.getAgent(toSessionId)
    if (!persistedAgent?.sdkSessionId) {
      return `Error: instance "${inst.instanceId}" has no resolvable session — it may not have initialised yet. Retry in a moment.`
    }
    const restart = runtime.restartParamsByRole.get(inst.roleId)
    if (!restart) {
      return `Error: instance "${inst.instanceId}" has no restart context in this agency.`
    }
    await startSession(
      {
        localId: toSessionId,
        agentLocalId: toSessionId,
        sessionLocalId: runtime.instanceId,
        projectPath: runtime.projectPath,
        ...(runtime.worktreePath ? { worktreePath: runtime.worktreePath } : {}),
        initialPrompt: persistedAgent.initialPrompt,
        resumeSdkSessionId: persistedAgent.sdkSessionId,
        systemPromptAppend: restart.systemPromptAppend,
        ...(restart.model ? { model: restart.model } : {}),
        ...(restart.effort
          ? { effort: restart.effort as import('../shared/ipc-contract').RoleEffort }
          : {}),
        agencyId: runtime.agencyId,
        agencyScope: runtime.agencyScope,
        roleId: inst.roleId,
        roleInstanceIndex: inst.instanceIndex,
        roleName: persistedAgent.roleName ?? inst.roleId,
        agencyName: runtime.agencyName,
        isEntryPoint: persistedAgent.isEntryPoint,
      },
      { mcpFactory: () => createOrchestratorMcp(runtime.projectPath, toSessionId) },
    )
    target = getActiveSession(toSessionId)!
  }

  const beforeCount = target.events.length

  try {
    await sendInput(toSessionId, content)
  } catch (err) {
    return `Error queuing message: ${err instanceof Error ? err.message : String(err)}`
  }

  let status: Awaited<ReturnType<typeof waitForNextIdle>>
  let timeoutTimer: NodeJS.Timeout | undefined
  try {
    status = await Promise.race([
      waitForNextIdle(toSessionId),
      new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(
          () => reject(new Error('send_message timeout')),
          SEND_MESSAGE_TIMEOUT_MS,
        )
      }),
    ])
  } catch (err) {
    if (err instanceof Error && err.message === 'send_message timeout') {
      return `Error: "${inst.instanceId}" did not reply within ${timeoutLabel()} — it may be stuck. The message was delivered; check that agent's session or retry.`
    }
    return `Error: target session "${inst.instanceId}" could not be awaited.`
  } finally {
    clearTimeout(timeoutTimer)
  }

  if (status !== 'idle') {
    return `Error: target session ended with status "${status}" before replying.`
  }

  const newEvents = target.events.slice(beforeCount)
  const replies: string[] = []
  for (const msg of newEvents) {
    const m = msg as unknown as { type?: string; message?: { content?: unknown } }
    if (m.type !== 'assistant') continue
    const inner = m.message?.content
    if (!Array.isArray(inner)) continue
    for (const block of inner) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>)['type'] === 'text' &&
        typeof (block as Record<string, unknown>)['text'] === 'string'
      ) {
        replies.push((block as Record<string, unknown>)['text'] as string)
      }
    }
  }
  return replies.join('\n\n').trim() || '(peer replied without text content)'
}

async function routeMessage(
  fromSessionId: string,
  to: string,
  content: string,
): Promise<string> {
  const runtime = runtimeOfSession(fromSessionId)
  if (!runtime) return 'Error: sender is not part of an active agency.'

  const fromInst = instanceOfSession(runtime, fromSessionId)
  if (!fromInst) return 'Error: sender has no instance mapping.'

  const fromRole = fromInst.roleId

  // Resolve the target: either an instance id ("developer-2") or a role id ("developer")
  const match = instanceIdPattern.exec(to)

  if (match) {
    // Direct targeting by instance id
    const targetRoleId = match[1]!
    const targetIndex = parseInt(match[2]!, 10)

    if (!isFlowAllowed(runtime, fromInst.instanceId, fromRole, to, targetRoleId)) {
      return `Error: "${fromInst.instanceId}" is not permitted to send_message to "${to}" in this agency.`
    }

    const list = runtime.instancesByRole.get(targetRoleId) ?? []
    const targetInst = list.find((i) => i.instanceIndex === targetIndex)
    if (!targetInst) {
      return `Error: no instance "${to}" found in this agency.`
    }

    if (targetInst.localId === fromSessionId) {
      return `Error: cannot send_message to yourself.`
    }

    if (wouldCycle(fromSessionId, targetInst.localId)) {
      return `Error: "${to}" is already waiting on your reply (directly or transitively). Calling send_message now would deadlock. Respond with plain text instead.`
    }

    // Injecting into a mid-turn instance would interleave two conversations and
    // race both callers' reply capture on the same idle transition.
    if (runtime.busySessions.has(targetInst.localId)) {
      return `Error: instance "${to}" is currently handling another message. Retry shortly, or send to role "${targetRoleId}" to reach any idle instance.`
    }

    addWait(fromSessionId, targetInst.localId)
    setAgentStatus(fromSessionId, 'blocked')
    try {
      return await deliverToInstance(runtime, targetInst, wrapMessage(fromInst.instanceId, content))
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`
    } finally {
      removeWait(fromSessionId, targetInst.localId)
      setAgentStatus(fromSessionId, 'running')
    }
  }

  // Role targeting — load-balance across instances of this role
  const toRole = to
  if (!isFlowAllowed(runtime, fromInst.instanceId, fromRole, toRole, toRole)) {
    return `Error: "${fromInst.instanceId}" is not permitted to send_message to "${toRole}" in this agency.`
  }

  if (!runtime.instancesByRole.has(toRole)) {
    return `Error: no role "${toRole}" in this agency.`
  }

  const findOrSpawnAndDeliver = async (): Promise<string> => {
    const idle = idleInstance(runtime, toRole)
    if (idle) {
      if (idle.localId === fromSessionId) {
        return 'Error: cannot send_message to yourself.'
      }
      if (wouldCycle(fromSessionId, idle.localId)) {
        return `Error: "${toRole}" is already waiting on your reply (directly or transitively). Calling send_message now would deadlock. Respond with plain text instead.`
      }
      addWait(fromSessionId, idle.localId)
      try {
        return await deliverToInstance(runtime, idle, wrapMessage(fromInst.instanceId, content))
      } finally {
        removeWait(fromSessionId, idle.localId)
      }
    }

    // No idle instance — check if we can spawn overflow
    const slot = runtime.roleSlots.get(toRole)
    const currentCount = (runtime.instancesByRole.get(toRole) ?? []).length
    if (slot?.max !== undefined && currentCount < slot.max) {
      // Collect all current instance ids to rebuild the peer list
      const allInstanceIds = buildAllInstanceIds(runtime)
      const rolesById = await buildRolesById(runtime)
      const newInst = await spawnOverflow(runtime, toRole, rolesById, allInstanceIds)
      addWait(fromSessionId, newInst.localId)
      try {
        return await deliverToInstance(runtime, newInst, wrapMessage(fromInst.instanceId, content))
      } finally {
        removeWait(fromSessionId, newInst.localId)
      }
    }

    // Enqueue — block until a slot opens, or time out so a stuck role can't
    // hold the caller forever. Entry identity decides who owns the resolution:
    // once drainPendingForRole shifts it out, the timeout is a no-op and
    // injectAndWait's own timeout takes over.
    return new Promise<string>((resolve, reject) => {
      if (!runtime.pendingByRole.has(toRole)) runtime.pendingByRole.set(toRole, [])
      const entry: PendingMessage = { content: wrapMessage(fromInst.instanceId, content), resolve, reject }
      runtime.pendingByRole.get(toRole)!.push(entry)
      setTimeout(() => {
        const queue = runtime.pendingByRole.get(toRole)
        const idx = queue?.indexOf(entry) ?? -1
        if (idx >= 0) {
          queue!.splice(idx, 1)
          resolve(`Error: no "${toRole}" instance became available within ${timeoutLabel()}. The message was NOT delivered; retry later.`)
        }
      }, SEND_MESSAGE_TIMEOUT_MS)
    })
  }

  setAgentStatus(fromSessionId, 'blocked')
  try {
    return await findOrSpawnAndDeliver()
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  } finally {
    setAgentStatus(fromSessionId, 'running')
  }
}

function wrapMessage(fromInstanceId: string, content: string): string {
  return [
    `[message from peer "${fromInstanceId}"]`,
    '',
    content,
    '',
    `[end message]`,
    '',
    `Respond to "${fromInstanceId}" with plain text. Your reply is captured automatically and returned as their send_message tool_result — DO NOT call send_message back to "${fromInstanceId}" (that would deadlock). If you need a different peer, call send_message to that peer normally.`,
  ].join('\n')
}

function buildAllInstanceIds(runtime: RuntimeAgency): string[] {
  const ids: string[] = []
  for (const instances of runtime.instancesByRole.values()) {
    for (const inst of instances) ids.push(inst.instanceId)
  }
  return ids
}

async function buildRolesById(
  runtime: RuntimeAgency,
): Promise<Map<string, { name: string; model: string | null; effort: string | null; systemPrompt: string }>> {
  const allRoles = await listRoles(runtime.projectPath)
  return new Map(allRoles.map((r) => [r.id, r]))
}

function buildContextPreamble(opts: {
  roleName: string
  roleId: string
  instanceIndex: number
  totalInstances: number
  instanceId: string
  agencyName: string
  allInstanceIds: string[]
  isEntry: boolean
  handoffLines: string
  /** null = any-to-any; [] = no outbound peers permitted */
  allowedPeerIds: string[] | null
}): string {
  const {
    roleName, roleId, instanceIndex, totalInstances, instanceId,
    agencyName, allInstanceIds, isEntry, handoffLines, allowedPeerIds,
  } = opts
  const instanceNote = totalInstances > 1 ? `, instance ${instanceIndex} of ${totalInstances}` : ''
  const peerRestrictionLines: string[] =
    allowedPeerIds === null
      ? []
      : allowedPeerIds.length > 0
        ? ['', `Flow-restricted: you may only send_message to — ${allowedPeerIds.join(', ')}.`]
        : ['', `Flow-restricted: you have no permitted outbound peers — do not call send_message.`]
  return [
    `You are the "${roleName}" (role: "${roleId}"${instanceNote}, id: "${instanceId}") in agency "${agencyName}".`,
    `Current agency members: ${allInstanceIds.join(', ')}.`,
    ``,
    `Addressing peers via mcp__agentkeeper__send_message:`,
    `- By instance id (e.g. "developer-2"): direct delivery to that specific instance.`,
    `- By role id (e.g. "developer"): load-balanced delivery — routes to an idle instance of`,
    `  that role, or spawns a NEW overflow instance if all are busy. Use role-id addressing`,
    `  whenever you want to fan out work in parallel or delegate to a peer of the same role.`,
    `  Overflow instances are temporary: they suspend after completing one task.`,
    ...peerRestrictionLines,
    ``,
    `Communication protocol:`,
    `- send_message BLOCKS until the peer replies; their response becomes your tool_result.`,
    `- To run sub-tasks in PARALLEL, emit multiple send_message tool calls in the same`,
    `  response turn before receiving any results — the orchestrator dispatches them`,
    `  concurrently and returns all results together.`,
    `- When another peer addresses YOU via send_message, you'll receive a user turn wrapped`,
    `  in "[message from peer X]" markers. Your plain-text reply is automatically captured`,
    `  and returned to them — DO NOT call send_message back to the peer that addressed you.`,
    `  That would deadlock both of you.`,
    `- If replying to peer X requires input from peer Z, you CAN call send_message(Z) first,`,
    `  then use Z's answer when composing your plain-text reply to X.`,
    ``,
    `Collaborate — don't try to do every role's job yourself.`,
    isEntry
      ? `You are an entry point — you receive the initial task from the user.`
      : `You will receive tasks from peer agents via send_message. Stand by until addressed.`,
    handoffLines,
  ].join('\n')
}

const planStepSchema = z.array(
  z.object({
    id: z.string().optional(),
    title: z.string(),
    summary: z.string().optional(),
    instructions: z.string().optional(),
    filesInScope: z.array(z.string()).optional(),
    model: z.string().describe('"claude-haiku-4-5" for reads/audits, "claude-sonnet-4-5" for implementation, "claude-opus-4-5" for complex architecture'),
    estimatedMinutes: z.number(),
    agent: z.string().describe('"explorer" | "main" | "qa" | "doc"'),
    parallel: z.boolean(),
    status: z.enum(['pending', 'running', 'complete', 'failed', 'skipped', 'replanning']).optional(),
  }),
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPlanTools(projectPath: string, sessionId?: string): SdkMcpToolDefinition<any>[] {
  return [
    tool(
      'create_plan',
      'Create a structured implementation plan stored in SQLite. Returns an id (UUID) that must be used with update_plan. Do NOT call this if a plan already exists for this task — use update_plan instead.',
      {
        title: z.string(),
        externalRef: z.string().describe('Ticket or feature ID, e.g. "EJP-45" or "auth-revamp".'),
        workItemId: z.string().optional(),
        prompt: z.string().optional().describe('Original task description or user request'),
        estimatedMinutes: z.number().describe('Sum of all step estimatedMinutes'),
        steps: planStepSchema,
      },
      async ({ title, externalRef, workItemId, prompt, estimatedMinutes, steps }) => {
        try {
          const plan = await createPlan(projectPath, {
            title,
            externalRef,
            workItemId: workItemId ?? '',
            prompt,
            estimatedMinutes,
            steps: steps.map((s) => ({ ...s, id: s.id ?? '', status: s.status ?? 'pending' })),
            status: 'planned',
            sessionIds: sessionId ? [sessionId] : [],
          })
          if (sessionId) {
            registry.updateSession(sessionId, {
              planState: plan.steps.map((s) => ({
                id: s.id,
                content: s.title,
                status: 'pending' as const,
              })),
            })
          }
          return { content: [{ type: 'text', text: JSON.stringify(plan) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
        }
      },
    ),
    tool(
      'update_plan',
      'Update an existing plan\'s status, steps, or session associations. Use id (UUID) returned by create_plan. The deprecated filename param is accepted as a fallback for legacy prompts.',
      {
        id: z.string().optional().describe('Plan UUID returned by create_plan. Preferred over filename.'),
        filename: z.string().optional().describe('[Deprecated] Plan filename, e.g. "EJP-45-plan.json". Used only when id is absent.'),
        status: z.enum(['planned', 'drafting', 'running', 'complete']).optional(),
        estimatedMinutes: z.number().optional(),
        steps: planStepSchema.optional(),
        sessionIds: z.array(z.string()).optional(),
        stepId: z.string().optional().describe('UUID of a single step to update atomically. Provide together with stepPatch.'),
        stepPatch: z.object({
          status: z.enum(['pending', 'running', 'complete', 'failed', 'skipped', 'replanning']).optional(),
          startedAt: z.number().nullable().optional(),
          completedAt: z.number().nullable().optional(),
          failedAt: z.number().nullable().optional(),
          actualMinutes: z.number().nullable().optional(),
        }).optional().describe('Fields to update on a single step when stepId is provided.'),
      },
      async ({ id: planId, filename, steps, stepId, stepPatch, ...rest }) => {
        try {
          let resolvedId = planId

          if (!resolvedId && filename) {
            const planRef = filename.replace(/-plan\.json$/, '')
            const found = await getPlanByRef(projectPath, planRef)
            resolvedId = found?.id
          }

          if (!resolvedId) {
            const label = planId ?? filename ?? '(none)'
            return { content: [{ type: 'text', text: `Error: plan "${label}" not found.` }] }
          }

          const patch = {
            ...rest,
            ...(steps !== undefined
              ? { steps: steps.map((s) => ({ ...s, id: s.id ?? '', status: s.status ?? 'pending' as const })) }
              : {}),
            ...(stepId !== undefined ? { stepId } : {}),
            ...(stepPatch !== undefined ? { stepPatch } : {}),
          }
          const updated = await updatePlan(projectPath, resolvedId, patch)
          if (!updated) return { content: [{ type: 'text', text: `Error: plan "${resolvedId}" not found.` }] }
          return { content: [{ type: 'text', text: JSON.stringify(updated) }] }
        } catch (err) {
          return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
        }
      },
    ),
  ]
}

export function createProjectMcp(
  projectPath: string,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'agentkeeper',
    version: '1.0.0',
    tools: buildPlanTools(projectPath),
  })
}

export function createOrchestratorMcp(
  projectPath: string,
  sessionId: string,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'agentkeeper',
    version: '1.0.0',
    tools: [
      ...buildPlanTools(projectPath, sessionId),
      tool(
        'send_message',
        'Send a message to a peer agent by instance id (e.g. "developer-1") or role id (e.g. "developer" for load-balanced delivery). Waits for their reply and returns it as the tool result.',
        {
          to: z.string().describe('Target agent instance id (e.g. "developer-1") or role id (e.g. "developer").'),
          content: z.string().describe('Message body to send to the peer.'),
        },
        async ({ to, content }) => {
          try {
            const reply = await routeMessage(sessionId, to, content)
            return { content: [{ type: 'text', text: reply }] }
          } catch (err) {
            return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }] }
          }
        },
      ),
    ],
  })
}

async function generateTitle(prompt: string): Promise<string> {
  const instruction = `Summarize the following task as a concise title of at most 8 words. Output only the title, no punctuation, no quotes.\n\n${prompt}`
  const stream = getHarness().runSession(instruction, { model: await getDefaultModel(), cwd: process.cwd() })
  for await (const event of stream) {
    if (event.type === 'result' && (event as {subtype?:string}).subtype === 'success') {
      return ((event as {result?:string}).result ?? '').trim()
    }
  }
  return ''
}

export async function generateAndPersistSessionTitle(localId: string, prompt: string): Promise<void> {
  try {
    const title = await generateTitle(prompt)
    if (title) {
      registry.updateSession(localId, { title })
      broadcastStatus({ sessionId: localId, title })
    }
  } catch {
    // non-fatal — card will fall back to initialPrompt
  }
}

const MAX_AGENT_RETRIES = 3

function handleAgentFailure(
  runtime: RuntimeAgency,
  roleId: string,
  localId: string,
  policy: OnFailurePolicy,
): void {
  if (policy === 'block') {
    const errMsg = `Agency halted: role "${roleId}" failed.`
    for (const otherId of runtime.sessionToInstance.keys()) {
      if (otherId !== localId) void interruptSession(otherId).catch(() => {})
    }
    for (const [, queue] of runtime.pendingByRole) {
      for (const p of queue.splice(0)) p.reject(new Error(errMsg))
    }
    return
  }

  if (policy === 'retry') {
    const attempt = runtime.retryCountByRole.get(roleId) ?? 0
    if (attempt >= MAX_AGENT_RETRIES) return // max retries hit — already in 'error', leave as-is

    runtime.retryCountByRole.set(roleId, attempt + 1)
    const backoffMs = Math.pow(2, attempt) * 1000
    const restart = runtime.restartParamsByRole.get(roleId)
    const inst = runtime.sessionToInstance.get(localId)
    const persisted = registry.getAgent(localId)
    if (!restart || !inst || !persisted) return

    setTimeout(() => {
      void startSession(
        {
          localId,
          agentLocalId: localId,
          sessionLocalId: runtime.instanceId,
          projectPath: runtime.projectPath,
          ...(runtime.worktreePath ? { worktreePath: runtime.worktreePath } : {}),
          initialPrompt: persisted.initialPrompt,
          systemPromptAppend: restart.systemPromptAppend,
          ...(restart.model ? { model: restart.model } : {}),
          ...(restart.effort ? { effort: restart.effort as RoleEffort } : {}),
          agencyId: runtime.agencyId,
          agencyScope: runtime.agencyScope,
          roleId: inst.roleId,
          roleInstanceIndex: inst.instanceIndex,
          roleName: persisted.roleName ?? inst.roleId,
          agencyName: runtime.agencyName,
          isEntryPoint: persisted.isEntryPoint,
        },
        {
          mcpFactory: () => createOrchestratorMcp(runtime.projectPath, localId),
          onTerminalError: () => handleAgentFailure(runtime, roleId, localId, policy),
        },
      )
    }, backoffMs)
    return
  }

  // 'continue': peer agents keep running; the failed agent is already marked 'error'
}

export async function startAgency(
  params: StartAgencyParams,
): Promise<AgencyInstance> {
  const agencies = await listAgencies(params.projectPath)
  const agency = agencies.find(
    (a) => a.id === params.agencyId && a.scope === params.agencyScope,
  )
  if (!agency) {
    throw new Error(`Agency "${params.agencyId}" (${params.agencyScope}) not found.`)
  }
  if (agency.roles.length === 0) throw new Error('Agency has no roles.')
  if (agency.entryPoints.length === 0) throw new Error('Agency has no entry points.')

  const allRoles = await listRoles(params.projectPath)
  const rolesById = new Map(allRoles.map((r) => [r.id, r]))
  for (const slot of agency.roles) {
    if (!rolesById.has(slot.roleId)) {
      throw new Error(`Role "${slot.roleId}" referenced by agency not found.`)
    }
  }

  let worktreePath: string | null = null
  let branch: string | null = null
  if (params.useWorktree && params.branch) {
    const wt = await createWorktree(params.projectPath, { branchRequest: params.branch })
    worktreePath = wt.path
    branch = wt.branch
  }

  const instanceId = randomUUID()

  // Register the single session row that represents this agency run.
  const sessionNow = Date.now()
  registry.registerSession({
    localId: instanceId,
    projectPath: params.projectPath,
    worktreePath: worktreePath ?? null,
    branch: branch ?? null,
    model: params.model ?? null,
    effort: null,
    permissionMode: 'bypassPermissions',
    initialPrompt: params.initialPrompt ?? '',
    agencyName: agency.name,
    agencyId: agency.id,
    agencyScope: agency.scope,
    title: null,
    workItemKey: params.workItemKey ?? null,
    workItemTitle: params.workItemTitle ?? null,
    status: 'starting',
    startedAt: sessionNow,
    lastActivityAt: sessionNow,
    lastUserMessageAt: null,
    planState: null,
  })

  const runtime: RuntimeAgency = {
    instanceId,
    agencyId: agency.id,
    agencyScope: agency.scope,
    agencyName: agency.name,
    projectPath: params.projectPath,
    worktreePath,
    branch,
    instancesByRole: new Map(),
    sessionToInstance: new Map(),
    busySessions: new Set(),
    pendingByRole: new Map(),
    handoffsByRole: new Map(),
    roleSlots: new Map(agency.roles.map((s) => [s.roleId, s])),
    allowedFlows: new Set(agency.flows.map(([from, to]) => `${from}->${to}`)),
    restartParamsByRole: new Map(),
    retryCountByRole: new Map(),
  }
  instances.set(instanceId, runtime)

  // First pass: determine how many permanent instances each role gets, so we can
  // build the complete peer-id list for the system prompt preamble.
  const spawnCounts: Array<{ slot: RoleSlot; count: number }> = agency.roles.map((slot) => {
    const count =
      slot.count !== undefined
        ? slot.count
        : slot.min !== undefined
          ? slot.min
          : 1
    return { slot, count }
  })

  const allRoleIds = agency.roles.map(s => s.roleId)
  const allInstanceIds: string[] = []
  for (const { slot, count } of spawnCounts) {
    for (let i = 1; i <= count; i++) {
      allInstanceIds.push(`${slot.roleId}-${i}`)
    }
  }

  const sessionsMeta: AgencyInstanceSession[] = []

  for (const { slot, count } of spawnCounts) {
    const role = rolesById.get(slot.roleId)!
    const isEntry = agency.entryPoints.includes(slot.roleId)
    const priorHandoffs = runtime.handoffsByRole.get(slot.roleId) ?? []
    const handoffLines =
      priorHandoffs.length > 0
        ? [
            '',
            `Prior work by previous ${role.name} agents:`,
            ...priorHandoffs.map((h) => `[Instance ${h.instanceIndex}]: ${h.summary}`),
          ].join('\n')
        : ''

    const totalInstances = slot.max ?? count

    const resolvedModel = role.model ?? params.model

    const restartBase: AgencyRoleRestartParams = {
      systemPromptAppend: '', // will be filled per-instance below
      model: resolvedModel ?? undefined,
      effort: role.effort ?? undefined,
    }

    for (let idx = 1; idx <= count; idx++) {
      const localId = randomUUID()
      const instId = `${slot.roleId}-${idx}`
      const allowedPeerIds = computeAllowedPeerIds(
        instId, slot.roleId, allInstanceIds, allRoleIds, runtime.allowedFlows,
      )
      const contextPreamble = buildContextPreamble({
        roleName: role.name,
        roleId: slot.roleId,
        instanceIndex: idx,
        totalInstances,
        instanceId: instId,
        agencyName: agency.name,
        allInstanceIds,
        isEntry,
        handoffLines,
        allowedPeerIds,
      })
      const systemPromptAppend = `${contextPreamble}\n\n${role.systemPrompt}`

      const initialPrompt =
        isEntry && idx === 1
          ? params.initialPrompt
          : `Agency "${agency.name}" is initializing. Await messages from peers.`

      await startSession(
        {
          localId,
          agentLocalId: localId,
          sessionLocalId: instanceId,
          projectPath: params.projectPath,
          ...(worktreePath ? { worktreePath } : {}),
          initialPrompt,
          ...(isEntry && idx === 1 && params.initialAttachments?.length
            ? { initialAttachments: params.initialAttachments }
            : {}),
          ...(resolvedModel ? { model: resolvedModel } : {}),
          ...(role.effort ? { effort: role.effort } : {}),
          systemPromptAppend,
          agencyId: agency.id,
          agencyScope: agency.scope,
          roleId: slot.roleId,
          roleInstanceIndex: idx,
          roleName: role.name,
          agencyName: agency.name,
          isEntryPoint: isEntry && idx === 1,
        },
        {
          mcpFactory: () => createOrchestratorMcp(params.projectPath, localId),
          onTerminalError: () => handleAgentFailure(
            runtime, slot.roleId, localId, slot.onFailure ?? 'continue',
          ),
        },
      )

      // Store per-instance restart params (the preamble varies per instance)
      runtime.restartParamsByRole.set(slot.roleId, {
        ...restartBase,
        systemPromptAppend,
      })

      const inst: AgentInstance = {
        localId,
        roleId: slot.roleId,
        instanceIndex: idx,
        instanceId: instId,
        isOverflow: false,
      }

      if (!runtime.instancesByRole.has(slot.roleId)) runtime.instancesByRole.set(slot.roleId, [])
      runtime.instancesByRole.get(slot.roleId)!.push(inst)
      runtime.sessionToInstance.set(localId, inst)
      sessionToRuntimeId.set(localId, instanceId)

      sessionsMeta.push({
        localId,
        sessionLocalId: instanceId,
        roleId: slot.roleId,
        instanceId: instId,
        instanceIndex: idx,
        roleName: role.name,
        isEntryPoint: isEntry && idx === 1,
        isOverflow: false,
      })
    }
  }

  void generateAndPersistSessionTitle(instanceId, params.initialPrompt)

  return {
    instanceId,
    agencyId: agency.id,
    agencyName: agency.name,
    projectPath: params.projectPath,
    worktreePath,
    branch,
    sessions: sessionsMeta,
  }
}

export async function resumeAgency(instanceId: string): Promise<AgencyInstance> {
  // Guard against concurrent resume calls for the same instance.
  if (instances.has(instanceId)) {
    const existing = listAgencyInstances().find((a) => a.instanceId === instanceId)
    if (existing) return existing
  }

  const memberAgents = registry.listAgentsBySession(instanceId)
  if (!memberAgents.length) throw new Error(`No agents found for agency instance "${instanceId}"`)

  const session = registry.getSession(instanceId)
  if (!session) throw new Error(`Session row missing for agency instance "${instanceId}"`)

  const agencyId = session.agencyId
  const agencyScope = session.agencyScope
  if (!agencyId || !agencyScope) throw new Error(`Agency id/scope missing from session for instance "${instanceId}"`)

  const projectPath = session.projectPath
  const worktreePath = session.worktreePath
  const branch = session.branch
  // Session-level model recorded at spawn — the fallback for roles that set no
  // model of their own, matching `role.model ?? params.model` in startAgency().
  const sessionModel = session.model ?? undefined

  const allAgencies = await listAgencies(projectPath)
  const agency = allAgencies.find((a) => a.id === agencyId && a.scope === agencyScope)
  if (!agency) throw new Error(`Agency "${agencyId}" (${agencyScope}) no longer exists.`)

  const allRoles = await listRoles(projectPath)
  const rolesById = new Map(allRoles.map((r) => [r.id, r]))

  // Build roleSessionMap from persisted agents
  const roleSessionMap: Record<string, Array<{ instanceIndex: number; sdkSessionId: string }>> = {}
  for (const agent of memberAgents) {
    if (!agent.roleId) continue
    const instanceIndex = agent.roleInstanceIndex ?? 1
    if (!roleSessionMap[agent.roleId]) roleSessionMap[agent.roleId] = []
    if (agent.sdkSessionId) {
      roleSessionMap[agent.roleId]!.push({ instanceIndex, sdkSessionId: agent.sdkSessionId })
    }
  }

  const sdkToLocalId = new Map<string, string>(
    memberAgents
      .filter((a): a is Agent & { sdkSessionId: string } => a.sdkSessionId !== null)
      .map((a) => [a.sdkSessionId, a.localId]),
  )

  const handoffsByRole = registry.getHandoffsByRole(instanceId)

  const runtime: RuntimeAgency = {
    instanceId,
    agencyId: agency.id,
    agencyScope: agency.scope,
    agencyName: agency.name,
    projectPath,
    worktreePath,
    branch,
    instancesByRole: new Map(),
    sessionToInstance: new Map(),
    busySessions: new Set(),
    pendingByRole: new Map(),
    handoffsByRole,
    roleSlots: new Map(agency.roles.map((s) => [s.roleId, s])),
    allowedFlows: new Set(agency.flows.map(([from, to]) => `${from}->${to}`)),
    restartParamsByRole: new Map(),
    retryCountByRole: new Map(),
  }
  instances.set(instanceId, runtime)

  // Build the full peer list from the reconstituted roleSessionMap
  const allRoleIds = agency.roles.map(s => s.roleId)
  const allInstanceIds: string[] = []
  for (const [roleId, entries] of Object.entries(roleSessionMap)) {
    for (const entry of entries) {
      allInstanceIds.push(`${roleId}-${entry.instanceIndex}`)
    }
  }

  const sessionsMeta: AgencyInstanceSession[] = []

  for (const slot of agency.roles) {
    const role = rolesById.get(slot.roleId)
    if (!role) continue

    const isEntry = agency.entryPoints.includes(slot.roleId)
    const priorHandoffs = handoffsByRole.get(slot.roleId) ?? []
    const handoffLines =
      priorHandoffs.length > 0
        ? [
            '',
            `Prior work by previous ${role.name} agents:`,
            ...priorHandoffs.map((h) => `[Instance ${h.instanceIndex}]: ${h.summary}`),
          ].join('\n')
        : ''

    const entries = roleSessionMap[slot.roleId] ?? []
    const totalInstances = slot.max ?? (slot.count ?? 1)

    for (const entry of entries) {
      const localId = sdkToLocalId.get(entry.sdkSessionId) ?? randomUUID()
      const instId = `${slot.roleId}-${entry.instanceIndex}`

      const allowedPeerIds = computeAllowedPeerIds(
        instId, slot.roleId, allInstanceIds, allRoleIds, runtime.allowedFlows,
      )
      const contextPreamble = buildContextPreamble({
        roleName: role.name,
        roleId: slot.roleId,
        instanceIndex: entry.instanceIndex,
        totalInstances,
        instanceId: instId,
        agencyName: agency.name,
        allInstanceIds,
        isEntry,
        handoffLines,
        allowedPeerIds,
      })

      const systemPromptAppend = `${contextPreamble}\n\n${role.systemPrompt}`
      const resolvedModel = role.model ?? sessionModel

      await startSession(
        {
          localId,
          agentLocalId: localId,
          sessionLocalId: instanceId,
          projectPath,
          ...(worktreePath ? { worktreePath } : {}),
          initialPrompt: `Agency "${agency.name}" resumed. Await messages from peers.`,
          systemPromptAppend,
          ...(resolvedModel ? { model: resolvedModel } : {}),
          ...(role.effort ? { effort: role.effort } : {}),
          agencyId: agency.id,
          agencyScope: agency.scope,
          roleId: slot.roleId,
          roleInstanceIndex: entry.instanceIndex,
          roleName: role.name,
          agencyName: agency.name,
          isEntryPoint: isEntry,
          ...(entry.sdkSessionId ? { resumeSdkSessionId: entry.sdkSessionId } : {}),
        },
        { mcpFactory: () => createOrchestratorMcp(projectPath, localId) },
      )

      runtime.restartParamsByRole.set(slot.roleId, {
        systemPromptAppend,
        model: resolvedModel,
        effort: role.effort ?? undefined,
      })

      const inst: AgentInstance = {
        localId,
        roleId: slot.roleId,
        instanceIndex: entry.instanceIndex,
        instanceId: instId,
        isOverflow: false,
      }

      if (!runtime.instancesByRole.has(slot.roleId)) runtime.instancesByRole.set(slot.roleId, [])
      runtime.instancesByRole.get(slot.roleId)!.push(inst)
      runtime.sessionToInstance.set(localId, inst)
      sessionToRuntimeId.set(localId, instanceId)

      sessionsMeta.push({
        localId,
        sessionLocalId: instanceId,
        roleId: slot.roleId,
        instanceId: instId,
        instanceIndex: entry.instanceIndex,
        roleName: role.name,
        isEntryPoint: isEntry,
        isOverflow: false,
      })
    }
  }

  return {
    instanceId,
    agencyId: agency.id,
    agencyName: agency.name,
    projectPath,
    worktreePath,
    branch,
    sessions: sessionsMeta,
  }
}

export function isAgencyRuntimeActive(instanceId: string): boolean {
  return instances.has(instanceId)
}

export function listAgencyInstances(): AgencyInstance[] {
  return Array.from(instances.values()).map((r) => ({
    instanceId: r.instanceId,
    agencyId: r.agencyId,
    agencyName: r.agencyName,
    projectPath: r.projectPath,
    worktreePath: r.worktreePath,
    branch: r.branch,
    sessions: Array.from(r.sessionToInstance.values()).map((inst) => ({
      localId: inst.localId,
      sessionLocalId: r.instanceId,
      roleId: inst.roleId,
      instanceId: inst.instanceId,
      instanceIndex: inst.instanceIndex,
      roleName: inst.roleId,
      isEntryPoint: false,
      isOverflow: inst.isOverflow,
    })),
  }))
}
