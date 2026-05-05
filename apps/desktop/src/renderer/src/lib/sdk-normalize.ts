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

  if (type === 'system' || type === 'result') return null
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

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
