import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { ContentBlock, SessionTranscript, TranscriptEvent } from '../../shared/ipc-contract'

function textContent(value: unknown): ContentBlock[] {
  if (typeof value === 'string') return value.trim() ? [{ type: 'text', text: value }] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((raw): ContentBlock[] => {
    if (!raw || typeof raw !== 'object') return []
    const block = raw as Record<string, unknown>
    const type = String(block['type'] ?? '').toLowerCase()
    if ((type === 'text' || type === 'input_text' || type === 'output_text') && typeof block['text'] === 'string') {
      return block['text'].trim() ? [{ type: 'text', text: block['text'] }] : []
    }
    return []
  })
}

// Older Codex wrote `user_message`/`agent_message` events; current builds log
// `item_completed` with a `UserMessage`/`AgentMessage` item instead. Both carry
// the text the user saw, without the context Codex injects into the prompt.
function conversationalMessage(
  payload: Record<string, unknown>,
): { role: 'user' | 'assistant'; phase: unknown; content: unknown } | null {
  const type = payload['type']
  if (type === 'user_message') return { role: 'user', phase: null, content: payload['message'] }
  if (type === 'agent_message') return { role: 'assistant', phase: payload['phase'], content: payload['message'] }
  if (type !== 'item_completed' || !payload['item'] || typeof payload['item'] !== 'object') return null
  const item = payload['item'] as Record<string, unknown>
  if (item['type'] === 'UserMessage') return { role: 'user', phase: null, content: item['content'] }
  if (item['type'] === 'AgentMessage') return { role: 'assistant', phase: item['phase'], content: item['content'] }
  return null
}

export function normalizeCodexTranscriptEvent(raw: unknown, fallbackId: string): TranscriptEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record['type'] !== 'event_msg' || !record['payload'] || typeof record['payload'] !== 'object') return null
  const payload = record['payload'] as Record<string, unknown>
  const message = conversationalMessage(payload)
  if (!message) return null
  // Commentary is represented by completed activity items during a live run.
  // Only the final response belongs in the restored conversational transcript.
  if (message.role === 'assistant' && message.phase && message.phase !== 'final_answer') return null
  const content = textContent(message.content)
  if (!content.length) return null
  const role = message.role
  return {
    uuid: fallbackId,
    parentUuid: null,
    timestamp: typeof record['timestamp'] === 'string' ? record['timestamp'] : '',
    kind: role,
    role,
    isMeta: false,
    isSidechain: false,
    model: null,
    content,
    parentToolUseId: null,
    systemSubtype: null,
  }
}

async function findRollout(root: string, sessionId: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) return null
  const suffix = `-${sessionId}.jsonl`
  async function visit(dir: string, depth: number): Promise<string | null> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(suffix)) return path.join(dir, entry.name)
    }
    if (depth >= 3) return null
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const found = await visit(path.join(dir, entry.name), depth + 1)
      if (found) return found
    }
    return null
  }
  return visit(root, 0)
}

export async function readCodexTranscript(
  sessionsRoot: string,
  projectPath: string | null,
  sessionId: string,
): Promise<SessionTranscript | null> {
  const filePath = await findRollout(sessionsRoot, sessionId)
  if (!filePath) return null
  const stat = await fs.promises.stat(filePath)
  const events: TranscriptEvent[] = []
  const versions = new Set<string>()
  let gitBranch: string | null = null
  let ordinal = 0
  const lines = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of lines) {
    if (!line.trim()) continue
    let parsed: unknown
    try { parsed = JSON.parse(line) } catch { continue }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      if (record['type'] === 'session_meta' && record['payload'] && typeof record['payload'] === 'object') {
        const meta = record['payload'] as Record<string, unknown>
        if (typeof meta['cli_version'] === 'string') versions.add(meta['cli_version'])
        const git = meta['git'] && typeof meta['git'] === 'object' ? meta['git'] as Record<string, unknown> : null
        if (typeof git?.['branch'] === 'string') gitBranch = git['branch']
      }
    }
    const event = normalizeCodexTranscriptEvent(parsed, `${sessionId}:${ordinal++}`)
    if (event) events.push(event)
  }
  return {
    id: sessionId,
    path: filePath,
    projectPath,
    gitBranch,
    versions: [...versions],
    events,
    lastActivityAt: stat.mtimeMs,
  }
}
