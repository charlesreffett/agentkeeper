import Database from 'better-sqlite3'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ContentBlock, SessionTranscript, TranscriptEvent } from '../../shared/ipc-contract'

/**
 * OpenCode does NOT use Claude's single `<sessionId>.jsonl`. It has two
 * historical persistence layouts, and this reads both back into the same
 * `TranscriptEvent[]` the renderer displays, so reloading an opencode session
 * shows its history instead of a blank pane.
 *
 * 1.18.x — SQLite at `~/.local/share/opencode/opencode.db`, tables `message`
 * and `part`, each row carrying the same JSON payload in a `data` column that
 * older builds wrote to disk as a file.
 *
 * 1.1.x — a tree of JSON files:
 *   storage/message/<sessionID>/<messageID>.json   — one message (role + meta)
 *   storage/part/<messageID>/<partID>.json         — that message's parts
 *
 * The DB wins when present; the file tree is the fallback for older installs.
 *
 * Part types mirror the live SSE `message.part.updated` shapes the adapter
 * already maps in `consumeTurn`, so the block mapping here is the disk twin of
 * that path.
 */

function storageRoot(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage')
}

function dbPath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
}

interface OpenCodeMessage {
  id: string
  role?: string
  parentID?: string
  time?: { created?: number; completed?: number }
  providerID?: string
  modelID?: string
  model?: { providerID?: string; modelID?: string }
}

async function readJsonDir<T>(dir: string): Promise<Array<{ id: string; data: T }>> {
  let entries: string[]
  try {
    entries = await fs.promises.readdir(dir)
  } catch {
    return []
  }
  const out: Array<{ id: string; data: T }> = []
  for (const file of entries) {
    if (!file.endsWith('.json')) continue
    try {
      const raw = await fs.promises.readFile(path.join(dir, file), 'utf8')
      out.push({ id: path.basename(file, '.json'), data: JSON.parse(raw) as T })
    } catch {
      // Skip unreadable/partial files rather than fail the whole read.
    }
  }
  return out
}

function modelOf(msg: OpenCodeMessage): string | null {
  const provider = msg.providerID ?? msg.model?.providerID
  const model = msg.modelID ?? msg.model?.modelID
  return provider && model ? `${provider}/${model}` : null
}

function partsToBlocks(parts: Array<Record<string, unknown>>): ContentBlock[] {
  const blocks: ContentBlock[] = []
  for (const part of parts) {
    const type = part['type'] as string
    if (type === 'text') {
      const text = (part['text'] as string) ?? ''
      if (text.trim()) blocks.push({ type: 'text', text })
    } else if (type === 'reasoning') {
      const text = (part['text'] as string) ?? ''
      if (text.trim()) blocks.push({ type: 'thinking', thinking: text })
    } else if (type === 'tool') {
      const state = part['state'] as Record<string, unknown> | undefined
      const callID = part['callID'] as string
      blocks.push({
        type: 'tool_use',
        id: callID,
        name: part['tool'] as string,
        input: state?.['input'] ?? {},
      })
      const status = state?.['status']
      if (status === 'completed' || status === 'error') {
        blocks.push({
          type: 'tool_result',
          tool_use_id: callID,
          content: state?.['output'] ?? '',
          is_error: status === 'error',
        })
      }
    }
    // step-start / step-finish / snapshot / file / agent parts carry no
    // displayable content — skip.
  }
  return blocks
}

/** Messages plus a per-message part lookup, already sorted, from either store. */
interface RawSession {
  messages: Array<{ id: string; data: OpenCodeMessage }>
  partsOf: (messageId: string) => Array<Record<string, unknown>>
  source: string
}

function readFromSqlite(sessionId: string): RawSession | null {
  if (!fs.existsSync(dbPath())) return null
  let db: Database.Database
  try {
    db = new Database(dbPath(), { readonly: true, fileMustExist: true })
  } catch {
    return null
  }
  try {
    const messageRows = db
      .prepare('SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created ASC, id ASC')
      .all(sessionId) as Array<{ id: string; data: string }>
    if (!messageRows.length) return null

    const partRows = db
      .prepare('SELECT message_id, data FROM part WHERE session_id = ? ORDER BY id ASC')
      .all(sessionId) as Array<{ message_id: string; data: string }>

    const parts = new Map<string, Array<Record<string, unknown>>>()
    for (const row of partRows) {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(row.data) as Record<string, unknown>
      } catch {
        continue
      }
      const list = parts.get(row.message_id)
      if (list) list.push(data)
      else parts.set(row.message_id, [data])
    }

    const messages: Array<{ id: string; data: OpenCodeMessage }> = []
    for (const row of messageRows) {
      try {
        messages.push({ id: row.id, data: JSON.parse(row.data) as OpenCodeMessage })
      } catch {
        // Skip a corrupt row rather than fail the whole transcript.
      }
    }
    if (!messages.length) return null

    return { messages, partsOf: (id) => parts.get(id) ?? [], source: dbPath() }
  } catch {
    return null
  } finally {
    db.close()
  }
}

async function readFromFileTree(sessionId: string): Promise<RawSession | null> {
  const messageDir = path.join(storageRoot(), 'message', sessionId)
  const messages = await readJsonDir<OpenCodeMessage>(messageDir)
  if (!messages.length) return null

  // Message ids are time-ordered, but sort on the stored timestamp to be safe.
  messages.sort(
    (a, b) => (a.data.time?.created ?? 0) - (b.data.time?.created ?? 0) || a.id.localeCompare(b.id),
  )

  const parts = new Map<string, Array<Record<string, unknown>>>()
  for (const { id: messageId } of messages) {
    const read = await readJsonDir<Record<string, unknown>>(
      path.join(storageRoot(), 'part', messageId),
    )
    read.sort((a, b) => a.id.localeCompare(b.id))
    parts.set(
      messageId,
      read.map((p) => p.data),
    )
  }

  return { messages, partsOf: (id) => parts.get(id) ?? [], source: messageDir }
}

export async function readOpenCodeTranscript(
  projectPath: string | null,
  sessionId: string,
): Promise<SessionTranscript | null> {
  const raw = readFromSqlite(sessionId) ?? (await readFromFileTree(sessionId))
  if (!raw) return null

  const events: TranscriptEvent[] = []
  let lastActivityAt = 0

  for (const { id: messageId, data: msg } of raw.messages) {
    const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : null
    if (!role) continue

    const content = partsToBlocks(raw.partsOf(messageId))
    if (!content.length) continue

    const created = msg.time?.created ?? 0
    const completed = msg.time?.completed ?? created
    if (completed > lastActivityAt) lastActivityAt = completed

    events.push({
      uuid: messageId,
      parentUuid: msg.parentID ?? null,
      timestamp: created ? new Date(created).toISOString() : '',
      kind: role,
      role,
      isMeta: false,
      isSidechain: false,
      model: role === 'assistant' ? modelOf(msg) : null,
      content,
      parentToolUseId: null,
      systemSubtype: null,
    })
  }

  if (!events.length) return null

  return {
    id: sessionId,
    path: raw.source,
    projectPath,
    gitBranch: null,
    versions: [],
    events,
    lastActivityAt,
  }
}
