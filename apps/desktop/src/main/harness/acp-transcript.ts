import fs from 'node:fs'
import readline from 'node:readline'
import type { ContentBlock, SessionTranscript, TranscriptEvent } from '../../shared/ipc-contract'

type Role = 'user' | 'assistant'

function textOf(content: unknown): string {
  if (!content || typeof content !== 'object') return ''
  const block = content as Record<string, unknown>
  return block['type'] === 'text' && typeof block['text'] === 'string' ? block['text'] : ''
}

// Tool output arrives as ACP ToolCallContent: `{ type: 'content', content: ContentBlock }`
// for text, or diffs/terminals we can only summarize.
function toolOutputOf(update: Record<string, unknown>): unknown {
  const content = update['content']
  if (Array.isArray(content)) {
    const texts = content.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const entry = item as Record<string, unknown>
      if (entry['type'] === 'content') {
        const text = textOf(entry['content'])
        return text ? [text] : []
      }
      if (entry['type'] === 'diff' && typeof entry['path'] === 'string') return [`Edited ${entry['path']}`]
      return []
    })
    if (texts.length) return texts.join('\n')
  }
  return update['rawOutput'] ?? ''
}

export function acpUpdatesToTranscriptEvents(sessionId: string, updates: unknown[]): TranscriptEvent[] {
  const events: TranscriptEvent[] = []
  let current: { role: Role; content: ContentBlock[] } | null = null
  const toolCalls = new Map<string, { name: string; input: unknown }>()
  const finishedTools = new Set<string>()

  const flush = (): void => {
    if (!current?.content.length) { current = null; return }
    const role = current.role
    events.push({
      uuid: `${sessionId}:${events.length}`,
      parentUuid: null,
      timestamp: '',
      kind: role,
      role,
      isMeta: false,
      isSidechain: false,
      model: null,
      content: current.content,
      parentToolUseId: null,
      systemSubtype: null,
    })
    current = null
  }
  const open = (role: Role): ContentBlock[] => {
    if (current?.role !== role) { flush(); current = { role, content: [] } }
    return current!.content
  }
  // Streaming chunks of the same kind concatenate into one block, so a reply
  // replayed as hundreds of deltas renders as a single message.
  const appendText = (role: Role, kind: 'text' | 'thinking', text: string): void => {
    if (!text) return
    const content = open(role)
    const last = content[content.length - 1]
    if (kind === 'text' && last?.type === 'text') last.text += text
    else if (kind === 'thinking' && last?.type === 'thinking') last.thinking += text
    else content.push(kind === 'text' ? { type: 'text', text } : { type: 'thinking', thinking: text })
  }

  for (const raw of updates) {
    if (!raw || typeof raw !== 'object') continue
    const update = raw as Record<string, unknown>
    switch (update['sessionUpdate']) {
      case 'user_message_chunk':
        appendText('user', 'text', textOf(update['content']))
        break
      case 'agent_message_chunk':
        appendText('assistant', 'text', textOf(update['content']))
        break
      case 'agent_thought_chunk':
        appendText('assistant', 'thinking', textOf(update['content']))
        break
      case 'tool_call': {
        const id = String(update['toolCallId'] ?? '')
        if (!id) break
        const call = { name: String(update['title'] ?? update['kind'] ?? 'tool'), input: update['rawInput'] ?? {} }
        toolCalls.set(id, call)
        open('assistant').push({ type: 'tool_use', id, ...call })
        const status = update['status']
        if (status === 'completed' || status === 'failed') {
          finishedTools.add(id)
          open('user').push({ type: 'tool_result', tool_use_id: id, content: toolOutputOf(update), is_error: status === 'failed' })
        }
        break
      }
      case 'tool_call_update': {
        const id = String(update['toolCallId'] ?? '')
        const status = update['status']
        if (!toolCalls.has(id) || finishedTools.has(id)) break
        if (status !== 'completed' && status !== 'failed') break
        finishedTools.add(id)
        open('user').push({ type: 'tool_result', tool_use_id: id, content: toolOutputOf(update), is_error: status === 'failed' })
        break
      }
    }
  }
  flush()
  return events
}

export function acpTranscript(
  sessionId: string,
  projectPath: string | null,
  source: string,
  updates: unknown[],
): SessionTranscript | null {
  const events = acpUpdatesToTranscriptEvents(sessionId, updates)
  if (!events.length) return null
  return { id: sessionId, path: source, projectPath, gitBranch: null, versions: [], events, lastActivityAt: 0 }
}

// Accepts each line as a bare SessionUpdate, a `{ sessionId, update }`
// notification payload, or a full JSON-RPC `session/update` message, since
// agents persist the stream at different layers.
export function acpUpdateFromLine(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (typeof record['sessionUpdate'] === 'string') return record
  if (record['update'] && typeof record['update'] === 'object') return record['update']
  const params = record['params'] as Record<string, unknown> | undefined
  if (params?.['update'] && typeof params['update'] === 'object') return params['update']
  return null
}

export async function readAcpUpdatesFile(filePath: string): Promise<unknown[] | null> {
  try {
    await fs.promises.access(filePath)
  } catch {
    return null
  }
  const updates: unknown[] = []
  const lines = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    try {
      const update = acpUpdateFromLine(JSON.parse(line))
      if (update) updates.push(update)
    } catch { /* tolerate a torn final line from an interrupted write */ }
  }
  return updates
}
