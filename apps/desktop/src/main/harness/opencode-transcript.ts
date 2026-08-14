import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ContentBlock, SessionTranscript, TranscriptEvent } from '../../shared/ipc-contract'

/**
 * OpenCode persists a session as a tree of JSON files under its storage dir,
 * NOT as Claude's single `<sessionId>.jsonl`. This reads that layout back into
 * the same `TranscriptEvent[]` the renderer already displays, so reloading an
 * opencode session shows its history instead of a blank pane.
 *
 * Layout (opencode 1.1.x):
 *   storage/message/<sessionID>/<messageID>.json   — one message (role + meta)
 *   storage/part/<messageID>/<partID>.json         — that message's parts
 *
 * Part types mirror the live SSE `message.part.updated` shapes the adapter
 * already maps in `consumeTurn`, so the block mapping here is the disk twin of
 * that path.
 */

function storageRoot(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage')
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

export async function readOpenCodeTranscript(
  projectPath: string | null,
  sessionId: string,
): Promise<SessionTranscript | null> {
  const messageDir = path.join(storageRoot(), 'message', sessionId)
  const messages = await readJsonDir<OpenCodeMessage>(messageDir)
  if (!messages.length) return null

  // Message ids are time-ordered, but sort on the stored timestamp to be safe.
  messages.sort(
    (a, b) => (a.data.time?.created ?? 0) - (b.data.time?.created ?? 0) || a.id.localeCompare(b.id),
  )

  const events: TranscriptEvent[] = []
  let lastActivityAt = 0

  for (const { id: messageId, data: msg } of messages) {
    const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : null
    if (!role) continue

    const partDir = path.join(storageRoot(), 'part', messageId)
    const parts = await readJsonDir<Record<string, unknown>>(partDir)
    parts.sort((a, b) => a.id.localeCompare(b.id))

    const content = partsToBlocks(parts.map((p) => p.data))
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
    path: messageDir,
    projectPath,
    gitBranch: null,
    versions: [],
    events,
    lastActivityAt,
  }
}
