import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'

function normalizeBlock(b: unknown): ContentBlock {
  if (!b || typeof b !== 'object') return { type: 'unknown', raw: b }
  const o = b as Record<string, unknown>
  switch (o['type']) {
    case 'text':
      return { type: 'text', text: String(o['text'] ?? '') }
    case 'thinking':
      return {
        type: 'thinking',
        thinking: String(o['thinking'] ?? ''),
        ...(typeof o['signature'] === 'string'
          ? { signature: o['signature'] }
          : {}),
      }
    case 'tool_use':
      return {
        type: 'tool_use',
        id: String(o['id'] ?? ''),
        name: String(o['name'] ?? ''),
        input: o['input'],
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: String(o['tool_use_id'] ?? ''),
        content: o['content'],
        is_error: o['is_error'] === true,
      }
    case 'image':
      return { type: 'image', source: o['source'] }
    default:
      return { type: 'unknown', raw: b }
  }
}

function normalizeContent(raw: unknown): ContentBlock[] {
  if (typeof raw === 'string') return [{ type: 'text', text: raw }]
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeBlock)
}

/**
 * Convert an SDKMessage emitted by @anthropic-ai/claude-agent-sdk into a
 * TranscriptEvent the existing renderer components know how to display.
 *
 * Returns null for messages that shouldn't appear in the transcript itself
 * (system init, result — those drive status/meta, not the message list).
 */
export function sdkMessageToTranscriptEvent(raw: unknown): TranscriptEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  const type = m['type']

  if (type === 'result') return null
  if (type === 'system') {
    const subtype = typeof m['subtype'] === 'string' ? m['subtype'] as string : 'system'
    if (subtype === 'init') return null
    const value = m['content'] ?? m['message'] ?? m['status'] ?? subtype.replaceAll('_', ' ')
    return eventFromBlocks([{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], {
      kind: 'system', role: 'system', systemSubtype: subtype,
    })
  }
  // partial_assistant, status, tool_progress, etc. — skip for V2
  if (type !== 'user' && type !== 'assistant') return null

  const messageWrapper = m['message'] as Record<string, unknown> | undefined
  const content = normalizeContent(messageWrapper?.['content'])
    .filter((b) => !(b.type === 'text' && !b.text.trim()))
  if (content.length === 0) return null

  const model =
    typeof messageWrapper?.['model'] === 'string'
      ? (messageWrapper['model'] as string)
      : null

  const parentToolUseId =
    typeof m['parent_tool_use_id'] === 'string'
      ? (m['parent_tool_use_id'] as string)
      : null

  return {
    uuid: typeof m['uuid'] === 'string' ? (m['uuid'] as string) : cryptoRandomId(),
    parentUuid: null,
    timestamp: new Date().toISOString(),
    kind: type,
    role: type,
    isMeta: false,
    isSidechain: parentToolUseId !== null,
    model,
    content,
    parentToolUseId,
    systemSubtype: null,
  }
}

function eventFromBlocks(
  content: ContentBlock[],
  overrides: Partial<TranscriptEvent> = {},
): TranscriptEvent {
  return {
    uuid: cryptoRandomId(), parentUuid: null, timestamp: new Date().toISOString(),
    kind: 'assistant', role: 'assistant', isMeta: false, isSidechain: false,
    model: null, content, parentToolUseId: null, systemSubtype: null, ...overrides,
  }
}

/** Translate rich provider stream payloads that do not use Anthropic's content
 * block protocol. Unknown/incremental bookkeeping events intentionally return
 * null; completed meaningful activity is retained in the transcript. */
export function harnessStreamToTranscriptEvent(raw: unknown): TranscriptEvent | null {
  if (!retiresObject(raw)) return null
  const wrapper = raw as Record<string, unknown>
  const providerId = typeof wrapper['provider'] === 'string' ? wrapper['provider'] : null
  const payload = retiresObject(wrapper['event']) ? wrapper['event'] as Record<string, unknown> : null
  if (!payload) return null

  if (providerId === 'codex') {
    const type = payload['type']
    if (type !== 'item.completed') return null
    const item = retiresObject(payload['item']) ? payload['item'] as Record<string, unknown> : null
    if (!item) return null
    const itemType = String(item['type'] ?? '')
    const id = String(item['id'] ?? cryptoRandomId())
    if (itemType === 'reasoning') {
      const text = String(item['text'] ?? item['summary'] ?? '')
      return text.trim() ? eventFromBlocks([{ type: 'thinking', thinking: text }], { uuid: id }) : null
    }
    if (itemType === 'command_execution') {
      const command = String(item['command'] ?? '')
      const output = item['aggregated_output'] ?? item['output'] ?? ''
      const exitCode = typeof item['exit_code'] === 'number' ? item['exit_code'] : null
      return eventFromBlocks([
        { type: 'tool_use', id, name: 'Bash', input: { command } },
        { type: 'tool_result', tool_use_id: id, content: output, is_error: exitCode !== null && exitCode !== 0 },
      ], { uuid: id })
    }
    if (itemType === 'file_change') {
      const changes = Array.isArray(item['changes']) ? item['changes'] : []
      if (changes.length) {
        const blocks: ContentBlock[] = []
        changes.forEach((rawChange, index) => {
          const change = retiresObject(rawChange) ? rawChange : { path: String(rawChange) }
          const changeId = `${id}:${index}`
          const kind = String(change['kind'] ?? change['type'] ?? '').toLowerCase()
          const name = /^(add|added|create|created)$/.test(kind)
            ? 'Create'
            : /^(delete|deleted|remove|removed)$/.test(kind)
              ? 'Delete'
              : 'Edit'
          blocks.push(
            { type: 'tool_use', id: changeId, name, input: { file_path: change['path'] ?? change['file_path'] ?? '', change } },
            { type: 'tool_result', tool_use_id: changeId, content: item['status'] ?? 'completed' },
          )
        })
        return eventFromBlocks(blocks, { uuid: id })
      }
      return eventFromBlocks([
        { type: 'tool_use', id, name: 'Edit', input: item },
        { type: 'tool_result', tool_use_id: id, content: item['status'] ?? 'completed' },
      ], { uuid: id })
    }
    if (itemType === 'mcp_tool_call' || itemType === 'tool_call') {
      const name = String(item['name'] ?? item['tool'] ?? 'Tool')
      return eventFromBlocks([
        { type: 'tool_use', id, name, input: item['arguments'] ?? item['input'] ?? {} },
        { type: 'tool_result', tool_use_id: id, content: item['result'] ?? '', is_error: item['status'] === 'failed' },
      ], { uuid: id })
    }
    return null
  }

  // ACP transports Cursor and Grok updates using the same session/update
  // envelope. Support the standard content and tool-call update variants.
  if (providerId === 'cursor' || providerId === 'grok') {
    const update = retiresObject(payload['params']) && retiresObject((payload['params'] as Record<string, unknown>)['update'])
      ? (payload['params'] as Record<string, unknown>)['update'] as Record<string, unknown>
      : null
    if (!update) return null
    const updateType = String(update['sessionUpdate'] ?? '')
    const content = retiresObject(update['content']) ? update['content'] as Record<string, unknown> : null
    if (updateType === 'agent_thought_chunk' && content?.['text']) {
      return eventFromBlocks([{ type: 'thinking', thinking: String(content['text']) }])
    }
    if (updateType === 'tool_call' || updateType === 'tool_call_update') {
      const id = String(update['toolCallId'] ?? update['id'] ?? cryptoRandomId())
      const name = String(update['title'] ?? update['name'] ?? 'Tool')
      const blocks: ContentBlock[] = [{ type: 'tool_use', id, name, input: update['rawInput'] ?? update['input'] ?? {} }]
      if (updateType === 'tool_call_update' && ('rawOutput' in update || 'output' in update)) {
        blocks.push({ type: 'tool_result', tool_use_id: id, content: update['rawOutput'] ?? update['output'], is_error: update['status'] === 'failed' })
      }
      return eventFromBlocks(blocks, { uuid: id })
    }
  }
  return null
}

function retiresObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
