import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type {
  AgencyInstance,
  AgencyInstanceSession,
  AgencyScope,
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
  startSession,
  waitForNextIdle,
  interruptSession,
} from './agent'
import * as registry from './session-registry'
import type { HandoffRecord, Session } from './session-registry'
import { resolveClaudeAuth } from './secrets'

interface AgencyRoleRestartParams {
  systemPromptAppend: string
  model: string | undefined
  effort: string | undefined
  allowedTools: string[] | undefined
}

interface AgentInstance {
  localId: string
  roleId: string
  instanceIndex: number
  instanceId: string
  isOverflow: boolean
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
}

const instances = new Map<string, RuntimeAgency>()
/** localId → instanceId — global index so createOrchestratorMcp can look up without inst ref */
const sessionToRuntimeId = new Map<string, string>()

function withOrchestraMcp(tools: string[] | null | undefined): string[] | undefined {
  if (!tools?.length) return undefined
  return [...new Set([...tools, 'mcp__agentkeeper__send_message'])]
}

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

async function spawnOverflow(
  runtime: RuntimeAgency,
  roleId: string,
  rolesById: Map<string, { name: string; model: string | null; effort: string | null; allowedTools: string[] | null; systemPrompt: string }>,
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

  const mcp = createOrchestratorMcp(localId)

  try {
    await startSession(
      {
        localId,
        projectPath: runtime.projectPath,
        ...(runtime.worktreePath ? { worktreePath: runtime.worktreePath } : {}),
        initialPrompt: `Agency "${runtime.agencyName}" overflow agent initialized. Await messages from peers.`,
        systemPromptAppend,
        ...(restart.model ? { model: restart.model } : {}),
        ...(restart.effort ? { effort: restart.effort as import('../shared/ipc-contract').RoleEffort } : {}),
        ...(restart.allowedTools ? { allowedTools: restart.allowedTools } : {}),
        agencyInstanceId: runtime.instanceId,
        agencyId: runtime.agencyId,
        agencyScope: runtime.agencyScope,
        roleId,
        roleInstanceIndex: nextIndex,
        roleName: role.name,
        agencyName: runtime.agencyName,
      },
      { mcpServer: mcp },
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
    const persisted = registry.getSession(toSessionId)
    if (!persisted?.sdkSessionId) {
      return `Error: instance "${inst.instanceId}" has no resolvable session — it may not have initialised yet. Retry in a moment.`
    }
    const restart = runtime.restartParamsByRole.get(inst.roleId)
    if (!restart) {
      return `Error: instance "${inst.instanceId}" has no restart context in this agency.`
    }
    const mcp = createOrchestratorMcp(toSessionId)
    await startSession(
      {
        localId: toSessionId,
        projectPath: runtime.projectPath,
        ...(runtime.worktreePath ? { worktreePath: runtime.worktreePath } : {}),
        initialPrompt: persisted.initialPrompt,
        resumeSdkSessionId: persisted.sdkSessionId,
        systemPromptAppend: restart.systemPromptAppend,
        ...(restart.model ? { model: restart.model } : {}),
        ...(restart.effort
          ? { effort: restart.effort as import('../shared/ipc-contract').RoleEffort }
          : {}),
        ...(restart.allowedTools ? { allowedTools: restart.allowedTools } : {}),
        agencyInstanceId: runtime.instanceId,
        roleId: inst.roleId,
        roleInstanceIndex: inst.instanceIndex,
        roleName: persisted.roleName ?? inst.roleId,
        agencyName: runtime.agencyName,
      },
      { mcpServer: mcp },
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
  try {
    status = await waitForNextIdle(toSessionId)
  } catch {
    return `Error: target session "${inst.instanceId}" could not be awaited.`
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
  const instanceIdPattern = /^(.+)-(\d+)$/
  const match = instanceIdPattern.exec(to)

  if (match) {
    // Direct targeting by instance id
    const targetRoleId = match[1]!
    const targetIndex = parseInt(match[2]!, 10)

    if (
      runtime.allowedFlows.size > 0 &&
      !runtime.allowedFlows.has(`${fromRole}->${targetRoleId}`)
    ) {
      return `Error: role "${fromRole}" is not permitted to send_message to "${targetRoleId}" in this agency.`
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

    addWait(fromSessionId, targetInst.localId)
    try {
      return await injectAndWait(runtime, targetInst, wrapMessage(fromInst.instanceId, content))
    } finally {
      removeWait(fromSessionId, targetInst.localId)
    }
  }

  // Role targeting — load-balance across instances of this role
  const toRole = to
  if (
    runtime.allowedFlows.size > 0 &&
    !runtime.allowedFlows.has(`${fromRole}->${toRole}`)
  ) {
    return `Error: role "${fromRole}" is not permitted to send_message to "${toRole}" in this agency.`
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

    // Enqueue — block until a slot opens
    return new Promise<string>((resolve, reject) => {
      if (!runtime.pendingByRole.has(toRole)) runtime.pendingByRole.set(toRole, [])
      runtime.pendingByRole.get(toRole)!.push({ content: wrapMessage(fromInst.instanceId, content), resolve, reject })
    })
  }

  return findOrSpawnAndDeliver()
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
): Promise<Map<string, { name: string; model: string | null; effort: string | null; allowedTools: string[] | null; systemPrompt: string }>> {
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
}): string {
  const {
    roleName, roleId, instanceIndex, totalInstances, instanceId,
    agencyName, allInstanceIds, isEntry, handoffLines,
  } = opts
  const instanceNote = totalInstances > 1 ? `, instance ${instanceIndex} of ${totalInstances}` : ''
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

export function createOrchestratorMcp(
  sessionId: string,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'agentkeeper',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        'Send a message to a peer agent by instance id (e.g. "developer-1") or role id (e.g. "developer" for load-balanced delivery). Waits for their reply and returns it as the tool result.',
        {
          to: z.string().describe('Target agent instance id (e.g. "developer-1") or role id (e.g. "developer").'),
          content: z.string().describe('Message body to send to the peer.'),
        },
        async ({ to, content }) => {
          const reply = await routeMessage(sessionId, to, content)
          return { content: [{ type: 'text', text: reply }] }
        },
      ),
    ],
  })
}

async function generateTitle(prompt: string): Promise<string> {
  const instruction = `Summarize the following task as a concise title of at most 8 words. Output only the title, no punctuation, no quotes.\n\n${prompt}`
  const auth = await resolveClaudeAuth()
  if (auth.type === 'api-key') {
    const client = new Anthropic({ apiKey: auth.key })
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 32,
      messages: [{ role: 'user', content: instruction }],
    })
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
  } else {
    const childEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-keeper',
    }
    const q = query({ prompt: instruction, options: { env: childEnv } })
    let result = ''
    for await (const event of q) {
      if (event.type === 'result' && event.subtype === 'success') {
        result = event.result
        break
      }
    }
    return result.trim()
  }
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

  const allInstanceIds: string[] = []
  for (const { slot, count } of spawnCounts) {
    for (let i = 1; i <= count; i++) {
      allInstanceIds.push(`${slot.roleId}-${i}`)
    }
  }

  const sessionsMeta: AgencyInstanceSession[] = []
  let entryLocalId: string | null = null

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
    const systemPromptForRole = (instanceIndex: number, instanceId: string) =>
      buildContextPreamble({
        roleName: role.name,
        roleId: slot.roleId,
        instanceIndex,
        totalInstances,
        instanceId,
        agencyName: agency.name,
        allInstanceIds,
        isEntry,
        handoffLines,
      })

    const restartBase: AgencyRoleRestartParams = {
      systemPromptAppend: '', // will be filled per-instance below
      model: resolvedModel ?? undefined,
      effort: role.effort ?? undefined,
      allowedTools: withOrchestraMcp(role.allowedTools),
    }

    for (let idx = 1; idx <= count; idx++) {
      const localId = randomUUID()
      const instId = `${slot.roleId}-${idx}`
      const contextPreamble = systemPromptForRole(idx, instId)
      const systemPromptAppend = `${contextPreamble}\n\n${role.systemPrompt}`

      const initialPrompt =
        isEntry && idx === 1
          ? params.initialPrompt
          : `Agency "${agency.name}" is initializing. Await messages from peers.`

      if (isEntry && idx === 1) entryLocalId = localId

      const mcp = createOrchestratorMcp(localId)

      await startSession(
        {
          localId,
          projectPath: params.projectPath,
          ...(worktreePath ? { worktreePath } : {}),
          initialPrompt,
          ...(resolvedModel ? { model: resolvedModel } : {}),
          ...(role.effort ? { effort: role.effort } : {}),
          systemPromptAppend,
          ...(withOrchestraMcp(role.allowedTools)
            ? { allowedTools: withOrchestraMcp(role.allowedTools) }
            : {}),
          agencyInstanceId: instanceId,
          agencyId: agency.id,
          agencyScope: agency.scope,
          roleId: slot.roleId,
          roleInstanceIndex: idx,
          roleName: role.name,
          agencyName: agency.name,
        },
        { mcpServer: mcp },
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
        roleId: slot.roleId,
        instanceId: instId,
        instanceIndex: idx,
        roleName: role.name,
        isEntryPoint: isEntry,
        isOverflow: false,
      })
    }
  }

  if (entryLocalId) void generateAndPersistSessionTitle(entryLocalId, params.initialPrompt)

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

  const memberSessions = registry.listSessionsByAgency(instanceId)
  if (!memberSessions.length) throw new Error(`No sessions found for agency instance "${instanceId}"`)

  const firstSession = memberSessions[0]!
  const agencyId = firstSession.agencyId
  const agencyScope = firstSession.agencyScope
  if (!agencyId || !agencyScope) throw new Error(`Agency id/scope missing from session for instance "${instanceId}"`)

  const projectPath = firstSession.projectPath
  const worktreePath = firstSession.worktreePath
  const branch = firstSession.branch

  const allAgencies = await listAgencies(projectPath)
  const agency = allAgencies.find((a) => a.id === agencyId && a.scope === agencyScope)
  if (!agency) throw new Error(`Agency "${agencyId}" (${agencyScope}) no longer exists.`)

  const allRoles = await listRoles(projectPath)
  const rolesById = new Map(allRoles.map((r) => [r.id, r]))

  // Build roleSessionMap from persisted sessions
  const roleSessionMap: Record<string, Array<{ instanceIndex: number; sdkSessionId: string }>> = {}
  for (const s of memberSessions) {
    if (!s.roleId) continue
    const instanceIndex = registry.getSessionRoleInstanceIndex(s.localId) ?? 1
    if (!roleSessionMap[s.roleId]) roleSessionMap[s.roleId] = []
    if (s.sdkSessionId) {
      roleSessionMap[s.roleId]!.push({ instanceIndex, sdkSessionId: s.sdkSessionId })
    }
  }

  const sdkToLocalId = new Map<string, string>(
    memberSessions
      .filter((s): s is Session & { sdkSessionId: string } => s.sdkSessionId !== null)
      .map((s) => [s.sdkSessionId!, s.localId]),
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
  }
  instances.set(instanceId, runtime)

  // Build the full peer list from the reconstituted roleSessionMap
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
      })

      const systemPromptAppend = `${contextPreamble}\n\n${role.systemPrompt}`
      const mcp = createOrchestratorMcp(localId)

      await startSession(
        {
          localId,
          projectPath,
          ...(worktreePath ? { worktreePath } : {}),
          initialPrompt: `Agency "${agency.name}" resumed. Await messages from peers.`,
          systemPromptAppend,
          ...(role.model ? { model: role.model } : {}),
          ...(role.effort ? { effort: role.effort } : {}),
          ...(withOrchestraMcp(role.allowedTools)
            ? { allowedTools: withOrchestraMcp(role.allowedTools) }
            : {}),
          agencyInstanceId: instanceId,
          agencyId: agency.id,
          agencyScope: agency.scope,
          roleId: slot.roleId,
          roleInstanceIndex: entry.instanceIndex,
          roleName: role.name,
          agencyName: agency.name,
          ...(entry.sdkSessionId ? { resumeSdkSessionId: entry.sdkSessionId } : {}),
        },
        { mcpServer: mcp },
      )

      runtime.restartParamsByRole.set(slot.roleId, {
        systemPromptAppend,
        model: role.model ?? undefined,
        effort: role.effort ?? undefined,
        allowedTools: withOrchestraMcp(role.allowedTools),
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
      roleId: inst.roleId,
      instanceId: inst.instanceId,
      instanceIndex: inst.instanceIndex,
      roleName: inst.roleId,
      isEntryPoint: false,
      isOverflow: inst.isOverflow,
    })),
  }))
}
