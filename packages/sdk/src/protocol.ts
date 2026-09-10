import { z } from 'zod'

/** Limits are part of the host/plugin wire contract, not merely SDK ergonomics. */
export const PLUGIN_PROTOCOL_LIMITS = {
  messageBytes: 12 * 1024 * 1024,
  messageDepth: 32,
  collectionEntries: 10_000,
  requestIdLength: 128,
  identifierLength: 256,
  keyLength: 512,
  storageValueBytes: 1024 * 1024,
  secretValueLength: 64 * 1024,
  eventPayloadBytes: 256 * 1024,
  logMessageLength: 16 * 1024,
  logMetadataBytes: 64 * 1024,
  uiContributionBytes: 256 * 1024,
  commandResultBytes: 1024 * 1024,
  workItemCount: 1_000,
  transitionCount: 256,
  networkBodyBytes: 10 * 1024 * 1024,
  nativeProcessArgs: 256,
  nativeProcessArgumentLength: 32 * 1024,
  nativeProcessEnvironmentEntries: 64,
} as const

export class PluginProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginProtocolError'
  }
}

type SizeState = { bytes: number; entries: number }

function addUtf8String(value: string, state: SizeState, maxBytes: number): void {
  // Count UTF-8 without allocating a second potentially attacker-sized buffer.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 0x80) state.bytes += 1
    else if (code < 0x800) state.bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      state.bytes += 4
      index++
    } else state.bytes += 3
    if (state.bytes > maxBytes) throw new PluginProtocolError(`Payload exceeds ${maxBytes} bytes`)
  }
}

function measureStructuredValue(
  value: unknown,
  state: SizeState,
  maxBytes: number,
  depth: number,
  ancestors: Set<object>,
): void {
  if (depth > PLUGIN_PROTOCOL_LIMITS.messageDepth) {
    throw new PluginProtocolError(`Payload exceeds maximum depth ${PLUGIN_PROTOCOL_LIMITS.messageDepth}`)
  }
  if (value === null || value === undefined) {
    state.bytes += 4
  } else if (typeof value === 'string') {
    addUtf8String(value, state, maxBytes)
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new PluginProtocolError('Payload contains a non-finite number')
    state.bytes += 8
  } else if (typeof value === 'boolean') {
    state.bytes += 1
  } else if (value instanceof ArrayBuffer) {
    state.bytes += value.byteLength
  } else if (ArrayBuffer.isView(value)) {
    state.bytes += value.byteLength
  } else if (typeof value === 'object') {
    if (ancestors.has(value)) throw new PluginProtocolError('Payload contains a circular reference')
    const prototype = Object.getPrototypeOf(value)
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
      throw new PluginProtocolError('Payload contains a non-plain object')
    }
    ancestors.add(value)
    if (Array.isArray(value)) {
      state.entries += value.length
      if (state.entries > PLUGIN_PROTOCOL_LIMITS.collectionEntries) {
        throw new PluginProtocolError('Payload contains too many collection entries')
      }
      for (const item of value) measureStructuredValue(item, state, maxBytes, depth + 1, ancestors)
    } else {
      const entries = Object.entries(value)
      state.entries += entries.length
      if (state.entries > PLUGIN_PROTOCOL_LIMITS.collectionEntries) {
        throw new PluginProtocolError('Payload contains too many collection entries')
      }
      for (const [entryKey, item] of entries) {
        addUtf8String(entryKey, state, maxBytes)
        measureStructuredValue(item, state, maxBytes, depth + 1, ancestors)
      }
    }
    ancestors.delete(value)
  } else {
    throw new PluginProtocolError(`Payload contains unsupported ${typeof value} value`)
  }
  if (state.bytes > maxBytes) throw new PluginProtocolError(`Payload exceeds ${maxBytes} bytes`)
}

/** Assert that a structured-clone value is finite, bounded, acyclic, and data-only. */
export function assertBoundedStructuredValue(value: unknown, maxBytes: number, label = 'Payload'): void {
  try {
    measureStructuredValue(value, { bytes: 0, entries: 0 }, maxBytes, 0, new Set())
  } catch (error) {
    if (error instanceof PluginProtocolError) throw new PluginProtocolError(`${label}: ${error.message}`)
    throw error
  }
}

const boundedString = (max: number) => z.string().max(max)
const requiredString = (max: number) => boundedString(max).min(1)
const requestId = requiredString(PLUGIN_PROTOCOL_LIMITS.requestIdLength)
const identifier = requiredString(PLUGIN_PROTOCOL_LIMITS.identifierLength)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Control characters are not allowed')
const key = requiredString(PLUGIN_PROTOCOL_LIMITS.keyLength)
const lifecycleAck = <T extends string>(type: T) => z.object({
  id: requestId,
  type: z.literal(type),
  error: boundedString(4_096).optional(),
}).strict()

const WorkItemStatusSchema = z.enum(['backlog', 'open', 'in_progress', 'in_review', 'done', 'closed'])
const StatusCategorySchema = z.enum(['todo', 'in-progress', 'done', 'unknown'])
const WorkItemLinkSchema = z.object({
  type: z.enum(['pr', 'branch', 'session', 'related']),
  url: requiredString(4_096),
  label: boundedString(1_024).optional(),
}).strict()
const CustomFieldsSchema = z.record(z.string(), boundedString(64 * 1024)).superRefine((fields, context) => {
  if (Object.keys(fields).length > 128) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many custom fields' })
  }
})
export const ProtocolWorkItemSchema = z.object({
  id: requiredString(512),
  source: identifier,
  externalRef: requiredString(1_024),
  title: boundedString(16 * 1024),
  body: boundedString(512 * 1024),
  status: WorkItemStatusSchema,
  statusLabel: boundedString(1_024).optional(),
  statusCategory: StatusCategorySchema.optional(),
  assignee: boundedString(1_024).optional(),
  reporter: boundedString(1_024).optional(),
  priority: boundedString(1_024).optional(),
  storyPoints: z.number().finite().optional(),
  issueType: boundedString(1_024).optional(),
  parentRef: boundedString(1_024).optional(),
  customFields: CustomFieldsSchema.optional(),
  links: z.array(WorkItemLinkSchema).max(64),
}).strict()
export const ProtocolIssueTransitionSchema = z.object({
  name: requiredString(1_024),
  toStatus: WorkItemStatusSchema,
  toStatusLabel: boundedString(1_024),
  toStatusCategory: StatusCategorySchema.optional(),
}).strict()

const workItemResultBase = { id: requestId, error: boundedString(4_096).optional() }
const PluginToHostMessageSchema = z.discriminatedUnion('type', [
  lifecycleAck('ready'),
  lifecycleAck('activated'),
  lifecycleAck('deactivated'),
  lifecycleAck('installed'),
  lifecycleAck('updated'),
  lifecycleAck('uninstalled'),
  z.object({ id: requestId, type: z.literal('runtime.error'), phase: requiredString(128), error: requiredString(4_096) }).strict(),
  z.object({ id: requestId, type: z.literal('storage.get'), key }).strict(),
  z.object({ id: requestId, type: z.literal('storage.set'), key, value: boundedString(PLUGIN_PROTOCOL_LIMITS.storageValueBytes) }).strict(),
  z.object({ id: requestId, type: z.literal('storage.delete'), key }).strict(),
  z.object({ id: requestId, type: z.literal('storage.list') }).strict(),
  z.object({ id: requestId, type: z.literal('projects.list') }).strict(),
  z.object({ id: requestId, type: z.literal('environment.get'), name: identifier }).strict(),
  z.object({ id: requestId, type: z.literal('secrets.get'), key }).strict(),
  z.object({ id: requestId, type: z.literal('secrets.set'), key, value: boundedString(PLUGIN_PROTOCOL_LIMITS.secretValueLength) }).strict(),
  z.object({ id: requestId, type: z.literal('secrets.delete'), key }).strict(),
  z.object({ id: requestId, type: z.literal('events.emit'), event: identifier, payload: z.unknown() }).strict(),
  z.object({ id: requestId, type: z.literal('events.on'), event: identifier, listenerId: requestId }).strict(),
  z.object({ id: requestId, type: z.literal('events.off'), listenerId: requestId }).strict(),
  z.object({ id: requestId, type: z.literal('workItems.register'), sourceId: identifier }).strict(),
  z.object({ id: requestId, type: z.literal('workItems.unregister'), sourceId: identifier }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.list.result'), items: z.array(ProtocolWorkItemSchema).max(PLUGIN_PROTOCOL_LIMITS.workItemCount).optional() }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.get.result'), item: ProtocolWorkItemSchema.optional() }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.updateStatus.result') }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.addComment.result') }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.getTransitions.result'), transitions: z.array(ProtocolIssueTransitionSchema).max(PLUGIN_PROTOCOL_LIMITS.transitionCount).optional() }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.transition.result') }).strict(),
  z.object({ ...workItemResultBase, type: z.literal('workItems.create.result'), item: ProtocolWorkItemSchema.optional() }).strict(),
  z.object({ id: requestId, type: z.literal('logger.debug'), message: boundedString(PLUGIN_PROTOCOL_LIMITS.logMessageLength), args: z.array(z.unknown()).max(8) }).strict(),
  z.object({ id: requestId, type: z.literal('logger.info'), message: boundedString(PLUGIN_PROTOCOL_LIMITS.logMessageLength), args: z.array(z.unknown()).max(8) }).strict(),
  z.object({ id: requestId, type: z.literal('logger.warn'), message: boundedString(PLUGIN_PROTOCOL_LIMITS.logMessageLength), args: z.array(z.unknown()).max(8) }).strict(),
  z.object({ id: requestId, type: z.literal('logger.error'), message: boundedString(PLUGIN_PROTOCOL_LIMITS.logMessageLength), args: z.array(z.unknown()).max(8) }).strict(),
  z.object({ id: requestId, type: z.literal('background.every'), intervalMs: z.number().int(), taskId: requestId }).strict(),
  z.object({ id: requestId, type: z.literal('background.once'), delayMs: z.number().int(), taskId: requestId }).strict(),
  z.object({ id: requestId, type: z.literal('background.cancel'), taskId: requestId }).strict(),
  z.object({ id: requestId, type: z.literal('ui.contribute'), registrationId: requestId, slot: z.enum(['sidebar.primary', 'session.detail.tabs', 'worktree.toolbar', 'commandPalette', 'settingsPanels', 'roleTemplates']), contribution: z.object({
    id: identifier,
    label: boundedString(2_048).optional(),
    icon: boundedString(2_048).optional(),
    order: z.number().finite().optional(),
  }).strict() }).strict(),
  z.object({ id: requestId, type: z.literal('ui.remove'), registrationId: requestId }).strict(),
  z.object({ id: requestId, type: z.literal('commands.register'), commandId: identifier, label: boundedString(2_048) }).strict(),
  z.object({ id: requestId, type: z.literal('commands.unregister'), commandId: identifier }).strict(),
  z.object({ id: requestId, type: z.literal('commands.invoke.result'), result: z.unknown().optional(), error: boundedString(4_096).optional() }).strict(),
  z.object({ id: requestId, type: z.literal('network.fetch'), url: requiredString(2_048), init: z.object({
    method: requiredString(32).optional(),
    headers: z.array(z.tuple([boundedString(8_192), boundedString(32 * 1024)])).max(256).optional(),
    body: z.instanceof(ArrayBuffer).refine((body) => body.byteLength <= PLUGIN_PROTOCOL_LIMITS.networkBodyBytes, 'Network body is too large').optional(),
  }).strict().optional() }).strict(),
  z.object({ id: requestId, type: z.literal('nativeProcess.execFile'), file: requiredString(2_048), args: z.array(boundedString(PLUGIN_PROTOCOL_LIMITS.nativeProcessArgumentLength)).max(PLUGIN_PROTOCOL_LIMITS.nativeProcessArgs), options: z.object({
    cwd: boundedString(4_096).optional(),
    env: z.record(z.string(), boundedString(32 * 1024)).superRefine((env, context) => {
      if (Object.keys(env).length > PLUGIN_PROTOCOL_LIMITS.nativeProcessEnvironmentEntries) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many environment entries' })
      }
    }).optional(),
    timeoutMs: z.number().int().min(100).max(120_000).optional(),
  }).strict().optional() }).strict(),
])

const HostToPluginMessageSchema = z.discriminatedUnion('type', [
  z.object({ id: requestId, type: z.literal('activate'), config: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ id: requestId, type: z.literal('deactivate') }).strict(),
  z.object({ id: requestId, type: z.literal('install') }).strict(),
  z.object({ id: requestId, type: z.literal('update'), previousVersion: requiredString(256) }).strict(),
  z.object({ id: requestId, type: z.literal('uninstall') }).strict(),
  z.object({ type: z.literal('response'), id: requestId, result: z.unknown().optional(), error: boundedString(4_096).optional() }).strict(),
  z.object({ type: z.literal('events.dispatch'), listenerId: requestId, event: identifier, payload: z.unknown() }).strict(),
  z.object({ type: z.literal('background.tick'), taskId: requestId }).strict(),
  z.object({ type: z.literal('workItems.list'), id: requestId, filter: z.unknown().optional() }).strict(),
  z.object({ type: z.literal('workItems.get'), id: requestId, itemId: identifier }).strict(),
  z.object({ type: z.literal('workItems.updateStatus'), id: requestId, itemId: identifier, status: WorkItemStatusSchema }).strict(),
  z.object({ type: z.literal('workItems.addComment'), id: requestId, itemId: identifier, comment: boundedString(512 * 1024) }).strict(),
  z.object({ type: z.literal('workItems.getTransitions'), id: requestId, itemId: identifier }).strict(),
  z.object({ type: z.literal('workItems.transition'), id: requestId, itemId: identifier, transitionId: identifier }).strict(),
  z.object({ type: z.literal('workItems.create'), id: requestId, fields: z.object({
    summary: requiredString(16 * 1024),
    description: boundedString(512 * 1024).optional(),
    issueType: boundedString(1_024).optional(),
    priority: boundedString(1_024).optional(),
    parentRef: boundedString(1_024).optional(),
  }).strict() }).strict(),
  z.object({ type: z.literal('commands.invoke'), id: requestId, commandId: identifier, args: z.unknown() }).strict(),
])

export type PluginToHostMessage = z.infer<typeof PluginToHostMessageSchema>
export type HostToPluginMessage = z.infer<typeof HostToPluginMessageSchema>

function validationMessage(error: z.ZodError): string {
  const issue = error.issues[0]
  return issue ? `${issue.path.join('.') || 'message'}: ${issue.message}` : 'Invalid message'
}

export function parsePluginToHostMessage(input: unknown): PluginToHostMessage {
  assertBoundedStructuredValue(input, PLUGIN_PROTOCOL_LIMITS.messageBytes, 'Plugin message')
  const result = PluginToHostMessageSchema.safeParse(input)
  if (!result.success) throw new PluginProtocolError(validationMessage(result.error))
  const message = result.data
  switch (message.type) {
    case 'storage.set': {
      try {
        const parsed = JSON.parse(message.value) as unknown
        assertBoundedStructuredValue(parsed, PLUGIN_PROTOCOL_LIMITS.storageValueBytes, 'Stored value')
      } catch (error) {
        if (error instanceof PluginProtocolError) throw error
        throw new PluginProtocolError('Stored value must be valid JSON')
      }
      break
    }
    case 'events.emit':
      assertBoundedStructuredValue(message.payload, PLUGIN_PROTOCOL_LIMITS.eventPayloadBytes, 'Event payload')
      break
    case 'logger.debug':
    case 'logger.info':
    case 'logger.warn':
    case 'logger.error':
      assertBoundedStructuredValue(message.args, PLUGIN_PROTOCOL_LIMITS.logMetadataBytes, 'Log metadata')
      break
    case 'ui.contribute':
      assertBoundedStructuredValue(message.contribution, PLUGIN_PROTOCOL_LIMITS.uiContributionBytes, 'UI contribution')
      break
    case 'commands.invoke.result':
      assertBoundedStructuredValue(message.result, PLUGIN_PROTOCOL_LIMITS.commandResultBytes, 'Command result')
      break
  }
  return message
}

export function parseHostToPluginMessage(input: unknown): HostToPluginMessage {
  assertBoundedStructuredValue(input, PLUGIN_PROTOCOL_LIMITS.messageBytes, 'Host message')
  const result = HostToPluginMessageSchema.safeParse(input)
  if (!result.success) throw new PluginProtocolError(validationMessage(result.error))
  return result.data
}
