import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import readline from 'node:readline'
import type {
  ContentBlock,
  EventKind,
  SessionSummary,
  SessionTranscript,
  TranscriptEvent,
} from '../shared/ipc-contract'

// ─── Path helpers ───────────────────────────────────────────────────────────

function claudeProjectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects')
}

export function encodeCwdForClaude(cwd: string): string {
  // Claude Code encodes a project cwd by replacing path separators with '-'.
  // Tested on POSIX: '/Volumes/workspace/foo' → '-Volumes-workspace-foo'.
  // Windows encoding is best-effort here; verify on first Windows run.
  return cwd
    .replaceAll('\\', '-')
    .replaceAll('/', '-')
    .replaceAll(':', '-')
}

function projectDir(projectPath: string): string {
  return path.join(claudeProjectsRoot(), encodeCwdForClaude(projectPath))
}

function snippet(s: string, maxLen = 200): string {
  const trimmed = s.trim().replace(/\s+/g, ' ')
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen - 1) + '…' : trimmed
}

// ─── Raw event normalization ────────────────────────────────────────────────

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

function classify(type: string): EventKind {
  switch (type) {
    case 'user':
    case 'assistant':
    case 'system':
    case 'progress':
    case 'summary':
      return type
    default:
      return 'other'
  }
}

function normalizeEvent(raw: unknown): TranscriptEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = typeof r['type'] === 'string' ? (r['type'] as string) : 'other'
  if (type === 'file-history-snapshot') return null

  const kind = classify(type)
  let content: ContentBlock[] = []
  let model: string | null = null
  let role: 'user' | 'assistant' | 'system' | null = null

  if (type === 'user' || type === 'assistant') {
    const msg = r['message'] as Record<string, unknown> | undefined
    content = normalizeContent(msg?.['content']).filter(
      (b) => !(b.type === 'text' && !b.text.trim()),
    )
    model = typeof msg?.['model'] === 'string' ? (msg['model'] as string) : null
    role = type
  } else if (type === 'system') {
    const text = typeof r['content'] === 'string' ? (r['content'] as string) : ''
    content = text ? [{ type: 'text', text }] : []
    role = 'system'
  } else if (type === 'progress') {
    const data = r['data'] as Record<string, unknown> | undefined
    const wrapper = data?.['message'] as Record<string, unknown> | undefined
    const inner = wrapper?.['message'] as Record<string, unknown> | undefined
    content = normalizeContent(inner?.['content']).filter(
      (b) => !(b.type === 'text' && !b.text.trim()),
    )
    model = typeof inner?.['model'] === 'string' ? (inner['model'] as string) : null
    role = 'assistant'
  } else if (type === 'summary') {
    const text = typeof r['summary'] === 'string' ? (r['summary'] as string) : ''
    content = text ? [{ type: 'text', text }] : []
  }

  return {
    uuid: typeof r['uuid'] === 'string' ? (r['uuid'] as string) : '',
    parentUuid:
      typeof r['parentUuid'] === 'string' ? (r['parentUuid'] as string) : null,
    timestamp:
      typeof r['timestamp'] === 'string' ? (r['timestamp'] as string) : '',
    kind,
    role,
    isMeta: r['isMeta'] === true,
    isSidechain: r['isSidechain'] === true,
    model,
    content,
    parentToolUseId:
      typeof r['parentToolUseID'] === 'string'
        ? (r['parentToolUseID'] as string)
        : null,
    systemSubtype:
      typeof r['subtype'] === 'string' ? (r['subtype'] as string) : null,
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

function extractUserTextFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const msg = r['message'] as Record<string, unknown> | undefined
  if (!msg) return null
  const content = msg['content']
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>)['type'] === 'text' &&
        typeof (block as Record<string, unknown>)['text'] === 'string'
      ) {
        return (block as Record<string, unknown>)['text'] as string
      }
    }
  }
  return null
}

function isDisplayable(parsed: Record<string, unknown>): boolean {
  if (parsed['isMeta'] === true) return false
  const t = parsed['type']
  return t === 'user' || t === 'assistant'
}

async function summarizeFile(fullPath: string): Promise<SessionSummary> {
  const stat = await fs.promises.stat(fullPath)
  const id = path.basename(fullPath, '.jsonl')

  let firstUserMessage: string | null = null
  let lastModel: string | null = null
  let firstTimestamp: string | null = null
  let lastTimestamp: string | null = null
  let messageCount = 0
  let gitBranch: string | null = null

  const rl = readline.createInterface({
    input: fs.createReadStream(fullPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }

    if (typeof parsed['timestamp'] === 'string') {
      if (!firstTimestamp) firstTimestamp = parsed['timestamp'] as string
      lastTimestamp = parsed['timestamp'] as string
    }
    if (!gitBranch && typeof parsed['gitBranch'] === 'string') {
      gitBranch = parsed['gitBranch'] as string
    }

    if (parsed['type'] === 'assistant') {
      const msg = parsed['message'] as Record<string, unknown> | undefined
      if (msg && typeof msg['model'] === 'string') {
        lastModel = msg['model'] as string
      }
    }

    if (isDisplayable(parsed)) {
      messageCount++
      if (!firstUserMessage && parsed['type'] === 'user') {
        const text = extractUserTextFromRaw(parsed)
        if (text && !text.startsWith('<')) {
          firstUserMessage = snippet(text)
        }
      }
    }
  }

  return {
    id,
    path: fullPath,
    startedAt: firstTimestamp
      ? new Date(firstTimestamp).getTime()
      : stat.birthtimeMs,
    lastActivityAt: lastTimestamp
      ? new Date(lastTimestamp).getTime()
      : stat.mtimeMs,
    messageCount,
    model: lastModel,
    firstUserMessage,
    gitBranch,
  }
}

export async function listSessions(
  projectPath: string,
): Promise<SessionSummary[]> {
  const dir = projectDir(projectPath)
  let entries: string[]
  try {
    entries = await fs.promises.readdir(dir)
  } catch {
    return []
  }

  const jsonlFiles = entries.filter((e) => e.endsWith('.jsonl'))

  const summaries = await Promise.all(
    jsonlFiles.map((filename) => summarizeFile(path.join(dir, filename))),
  )

  summaries.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  return summaries
}

export async function deleteHistoricalSession(
  projectPath: string,
  sessionId: string,
): Promise<void> {
  const filePath = path.join(projectDir(projectPath), `${sessionId}.jsonl`)
  try {
    await fs.promises.unlink(filePath)
  } catch {
    // ignore if already gone
  }
}

export async function deleteAllHistoricalSessions(projectPath: string): Promise<void> {
  const dir = projectDir(projectPath)
  let entries: string[]
  try {
    entries = await fs.promises.readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((e) => e.endsWith('.jsonl'))
      .map((e) => fs.promises.unlink(path.join(dir, e)).catch(() => {})),
  )
}

export async function truncateSessionJsonl(
  projectPath: string,
  sdkSessionId: string,
  fromUuid: string,
): Promise<{ keptCount: number; removedLines: string[] }> {
  const filePath = path.join(projectDir(projectPath), `${sdkSessionId}.jsonl`)
  let rawContent: string
  try {
    rawContent = await fs.promises.readFile(filePath, 'utf8')
  } catch {
    return { keptCount: 0, removedLines: [] }
  }
  const allLines = rawContent.split('\n').filter((l) => l.trim())
  let cutIndex = -1
  for (let i = 0; i < allLines.length; i++) {
    try {
      const obj = JSON.parse(allLines[i]!) as Record<string, unknown>
      if (obj['uuid'] === fromUuid) { cutIndex = i; break }
    } catch { /* skip malformed */ }
  }
  if (cutIndex === -1) return { keptCount: allLines.length, removedLines: [] }
  const keptLines = allLines.slice(0, cutIndex)
  const removedLines = allLines.slice(cutIndex)
  const tmpPath = `${filePath}.tmp`
  await fs.promises.writeFile(tmpPath, keptLines.length > 0 ? keptLines.join('\n') + '\n' : '', 'utf8')
  await fs.promises.rename(tmpPath, filePath)
  return { keptCount: keptLines.length, removedLines }
}

export async function restoreSessionJsonl(
  projectPath: string,
  sdkSessionId: string,
  keptCount: number,
  linesToAppend: string[],
): Promise<void> {
  if (linesToAppend.length === 0) return
  const filePath = path.join(projectDir(projectPath), `${sdkSessionId}.jsonl`)
  let rawContent = ''
  try { rawContent = await fs.promises.readFile(filePath, 'utf8') } catch { /* new file */ }
  const currentLines = rawContent.split('\n').filter((l) => l.trim())
  const restored = [...currentLines.slice(0, keptCount), ...linesToAppend]
  const tmpPath = `${filePath}.tmp`
  await fs.promises.writeFile(tmpPath, restored.join('\n') + '\n', 'utf8')
  await fs.promises.rename(tmpPath, filePath)
}

export async function readSession(
  projectPath: string,
  sessionId: string,
): Promise<SessionTranscript | null> {
  const filePath = path.join(projectDir(projectPath), `${sessionId}.jsonl`)
  let stat: fs.Stats
  try {
    stat = await fs.promises.stat(filePath)
  } catch {
    return null
  }

  const events: TranscriptEvent[] = []
  let gitBranch: string | null = null
  const versions = new Set<string>()

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  for await (const line of rl) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    if (parsed && typeof parsed === 'object') {
      const r = parsed as Record<string, unknown>
      if (!gitBranch && typeof r['gitBranch'] === 'string') {
        gitBranch = r['gitBranch'] as string
      }
      if (typeof r['version'] === 'string') {
        versions.add(r['version'] as string)
      }
    }
    const evt = normalizeEvent(parsed)
    if (evt) events.push(evt)
  }

  return {
    id: sessionId,
    path: filePath,
    projectPath,
    gitBranch,
    versions: Array.from(versions),
    events,
    lastActivityAt: stat.mtimeMs,
  }
}
