import { randomUUID } from 'node:crypto'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type {
  AgencyInstance,
  AgencyInstanceSession,
  AgencyScope,
  StartAgencyParams,
} from '../shared/ipc-contract'
import { listAgencies } from './agencies'
import { listRoles } from './roles'
import { createWorktree } from './worktrees'
import {
  getActiveSession,
  sendInput,
  startSession,
  waitForNextIdle,
} from './agent'

/**
 * Runtime state for one live run of an agency. Each run is a bundle of
 * sessions (one per role) that can message each other via the send_message
 * MCP tool the orchestrator injects into every member session.
 */
interface RuntimeAgency {
  instanceId: string
  agencyId: string
  agencyScope: AgencyScope
  agencyName: string
  projectPath: string
  worktreePath: string | null
  branch: string | null
  /** roleId → local sessionId */
  sessionByRole: Map<string, string>
  /** local sessionId → roleId */
  roleBySessionId: Map<string, string>
  /** Directional allowlist: "fromRoleId->toRoleId" strings. Empty = allow all. */
  allowedFlows: Set<string>
}

const instances = new Map<string, RuntimeAgency>()
const sessionToInstance = new Map<string, string>()
/**
 * Who is each session currently waiting on a reply from?
 * If X has called send_message(Y) and is awaiting Y's idle, waitingFor[X] = Y.
 * Used to detect cycles: if Y tries to call send_message(Z), and Z is
 * transitively waiting on Y (or on anyone in Y's chain), a call would
 * deadlock forever — reject with an informative error instead.
 */
const waitingFor = new Map<string, string>()

function instanceOfSession(sessionId: string): RuntimeAgency | null {
  const id = sessionToInstance.get(sessionId)
  return id ? (instances.get(id) ?? null) : null
}

function wouldCycle(from: string, to: string): boolean {
  // Would `from calls to` create a cycle? i.e., is `to` (transitively)
  // waiting on `from`?
  let cursor: string | undefined = to
  const visited = new Set<string>()
  while (cursor) {
    if (visited.has(cursor)) return true
    visited.add(cursor)
    const waitsOn = waitingFor.get(cursor)
    if (waitsOn === from) return true
    cursor = waitsOn
  }
  return false
}

async function routeMessage(
  fromSessionId: string,
  toRole: string,
  content: string,
): Promise<string> {
  const inst = instanceOfSession(fromSessionId)
  if (!inst) return 'Error: sender is not part of an active agency.'

  const fromRole = inst.roleBySessionId.get(fromSessionId)
  if (!fromRole) return 'Error: sender has no role.'

  if (
    inst.allowedFlows.size > 0 &&
    !inst.allowedFlows.has(`${fromRole}->${toRole}`)
  ) {
    return `Error: role "${fromRole}" is not permitted to send_message to "${toRole}" in this agency.`
  }

  const toSessionId = inst.sessionByRole.get(toRole)
  if (!toSessionId) return `Error: no active agent with role "${toRole}".`

  if (wouldCycle(fromSessionId, toSessionId)) {
    return `Error: "${toRole}" is already waiting on your reply (directly or transitively). Calling send_message now would deadlock both of you. Respond with plain text instead — your reply is delivered automatically as the caller's tool_result.`
  }

  const target = getActiveSession(toSessionId)
  if (!target) {
    return `Error: target session for role "${toRole}" is no longer active.`
  }

  const beforeCount = target.events.length

  try {
    sendInput(
      toSessionId,
      [
        `[message from peer "${fromRole}"]`,
        '',
        content,
        '',
        `[end message]`,
        '',
        `Respond to "${fromRole}" with plain text. Your reply is captured automatically and returned as their send_message tool_result — DO NOT call send_message back to "${fromRole}" (that would deadlock). If you need a different peer, call send_message to that peer normally.`,
      ].join('\n'),
    )
  } catch (err) {
    return `Error queuing message: ${err instanceof Error ? err.message : String(err)}`
  }

  waitingFor.set(fromSessionId, toSessionId)
  let status: Awaited<ReturnType<typeof waitForNextIdle>>
  try {
    status = await waitForNextIdle(toSessionId)
  } finally {
    waitingFor.delete(fromSessionId)
  }
  if (status !== 'idle') {
    return `Error: target session ended with status "${status}" before replying.`
  }

  // Extract assistant text emitted since beforeCount.
  const newEvents = target.events.slice(beforeCount)
  const replies: string[] = []
  for (const msg of newEvents) {
    const m = msg as unknown as {
      type?: string
      message?: { content?: unknown }
    }
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
  const reply = replies.join('\n\n').trim()
  return reply || '(peer replied without text content)'
}

export function createOrchestratorMcp(
  sessionId: string,
): ReturnType<typeof createSdkMcpServer> {
  return createSdkMcpServer({
    name: 'orchestral',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        'Send a message to a peer agent by role id. Waits for their reply and returns it as the tool result. Use this to collaborate with other agents in the same agency.',
        {
          to: z.string().describe('Target agent role id (e.g. "developer").'),
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

export async function startAgency(
  params: StartAgencyParams,
): Promise<AgencyInstance> {
  const agencies = await listAgencies(params.projectPath)
  const agency = agencies.find(
    (a) => a.id === params.agencyId && a.scope === params.agencyScope,
  )
  if (!agency) {
    throw new Error(
      `Agency "${params.agencyId}" (${params.agencyScope}) not found.`,
    )
  }
  if (agency.roles.length === 0) throw new Error('Agency has no roles.')
  if (agency.entryPoints.length === 0) {
    throw new Error('Agency has no entry points.')
  }

  const allRoles = await listRoles(params.projectPath)
  const rolesById = new Map(allRoles.map((r) => [r.id, r]))
  for (const roleId of agency.roles) {
    if (!rolesById.has(roleId)) {
      throw new Error(`Role "${roleId}" referenced by agency not found.`)
    }
  }

  let worktreePath: string | null = null
  let branch: string | null = null
  if (params.useWorktree && params.branch) {
    const wt = await createWorktree(params.projectPath, {
      branchRequest: params.branch,
    })
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
    sessionByRole: new Map(),
    roleBySessionId: new Map(),
    allowedFlows: new Set(
      agency.flows.map(([from, to]) => `${from}->${to}`),
    ),
  }
  instances.set(instanceId, runtime)

  const peerList = agency.roles.join(', ')
  const sessionsMeta: AgencyInstanceSession[] = []

  for (const roleId of agency.roles) {
    const role = rolesById.get(roleId)!
    const localId = randomUUID()

    const isEntry = agency.entryPoints.includes(roleId)
    const contextPreamble = [
      `You are the "${role.name}" (role id: "${roleId}") in an agency named "${agency.name}".`,
      `All member roles (by id): ${peerList}.`,
      ``,
      `Communication protocol:`,
      `- Use the mcp__orchestral__send_message tool to contact a peer by role id.`,
      `- send_message BLOCKS until the peer replies; their response becomes your tool_result.`,
      `- When another peer addresses YOU via send_message, you'll receive a user turn wrapped in "[message from peer X]" markers. Your plain-text reply is automatically captured and returned to them — DO NOT call send_message back to the peer that addressed you. That would deadlock both of you and the orchestrator will reject it.`,
      `- If replying to peer X requires input from peer Z, you CAN call send_message(Z) first, then use Z's answer when composing your plain-text reply to X. That's fine as long as Z isn't also waiting on you.`,
      ``,
      `Collaborate — don't try to do every role's job yourself.`,
      isEntry
        ? `You are an entry point — you receive the initial task from the user.`
        : `You will receive tasks from peer agents via send_message. Stand by until addressed.`,
    ].join('\n')

    const systemPromptAppend = `${contextPreamble}\n\n${role.systemPrompt}`
    const initialPrompt = isEntry
      ? params.initialPrompt
      : `Agency "${agency.name}" is initializing. Await messages from peers. If you receive no message, stand by — you don't need to take action until addressed.`

    const mcp = createOrchestratorMcp(localId)

    await startSession(
      {
        localId,
        projectPath: params.projectPath,
        ...(worktreePath ? { worktreePath } : {}),
        initialPrompt,
        ...(role.model
          ? { model: role.model }
          : params.model
            ? { model: params.model }
            : {}),
        systemPromptAppend,
        ...(role.allowedTools && role.allowedTools.length
          ? { allowedTools: role.allowedTools }
          : {}),
        agencyInstanceId: instanceId,
        roleId,
      },
      { mcpServer: mcp },
    )

    runtime.sessionByRole.set(roleId, localId)
    runtime.roleBySessionId.set(localId, roleId)
    sessionToInstance.set(localId, instanceId)

    sessionsMeta.push({
      localId,
      roleId,
      roleName: role.name,
      isEntryPoint: isEntry,
    })
  }

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

export function listAgencyInstances(): AgencyInstance[] {
  return Array.from(instances.values()).map((r) => ({
    instanceId: r.instanceId,
    agencyId: r.agencyId,
    agencyName: r.agencyName,
    projectPath: r.projectPath,
    worktreePath: r.worktreePath,
    branch: r.branch,
    sessions: Array.from(r.sessionByRole.entries()).map(([roleId, localId]) => ({
      localId,
      roleId,
      roleName: roleId,
      isEntryPoint: false,
    })),
  }))
}
