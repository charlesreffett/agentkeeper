import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { acpTranscript, acpUpdatesToTranscriptEvents, readAcpUpdatesFile } from './acp-transcript'

const text = (t: string) => ({ type: 'text', text: t })

describe('acpUpdatesToTranscriptEvents', () => {
  it('merges streamed chunks into one message per turn side', () => {
    const events = acpUpdatesToTranscriptEvents('s1', [
      { sessionUpdate: 'user_message_chunk', content: text('Hello ') },
      { sessionUpdate: 'user_message_chunk', content: text('there') },
      { sessionUpdate: 'agent_thought_chunk', content: text('pondering') },
      { sessionUpdate: 'agent_message_chunk', content: text('Hi') },
      { sessionUpdate: 'agent_message_chunk', content: text('!') },
    ])
    expect(events.map((e) => [e.role, e.content])).toEqual([
      ['user', [{ type: 'text', text: 'Hello there' }]],
      ['assistant', [{ type: 'thinking', thinking: 'pondering' }, { type: 'text', text: 'Hi!' }]],
    ])
    expect(new Set(events.map((e) => e.uuid)).size).toBe(2)
  })

  it('pairs tool calls with their completed results', () => {
    const events = acpUpdatesToTranscriptEvents('s1', [
      { sessionUpdate: 'user_message_chunk', content: text('list files') },
      { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls', status: 'pending', rawInput: { path: '.' } },
      { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'in_progress' },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        content: [{ type: 'content', content: text('a.ts\nb.ts') }],
      },
      { sessionUpdate: 'agent_message_chunk', content: text('Two files.') },
    ])
    expect(events.map((e) => [e.role, e.content])).toEqual([
      ['user', [{ type: 'text', text: 'list files' }]],
      ['assistant', [{ type: 'tool_use', id: 't1', name: 'ls', input: { path: '.' } }]],
      ['user', [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts\nb.ts', is_error: false }]],
      ['assistant', [{ type: 'text', text: 'Two files.' }]],
    ])
  })

  it('marks failed tools as errors and ignores unknown updates', () => {
    const events = acpUpdatesToTranscriptEvents('s1', [
      { sessionUpdate: 'tool_call', toolCallId: 't1', kind: 'execute', status: 'failed', rawOutput: 'boom' },
      { sessionUpdate: 'plan', entries: [] },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
    ])
    expect(events.map((e) => e.content)).toEqual([
      [{ type: 'tool_use', id: 't1', name: 'execute', input: {} }],
      [{ type: 'tool_result', tool_use_id: 't1', content: 'boom', is_error: true }],
    ])
  })

  it('returns no transcript for an empty replay', () => {
    expect(acpTranscript('s1', '/p', 'acp:grok', [])).toBeNull()
  })
})

describe('readAcpUpdatesFile', () => {
  it('reads every persisted line shape and survives a torn final line', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-updates-'))
    const file = path.join(dir, 'updates.jsonl')
    fs.writeFileSync(file, [
      JSON.stringify({ sessionUpdate: 'user_message_chunk', content: text('a') }),
      JSON.stringify({ sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: text('b') } }),
      JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: text('c') } } }),
      '{"sessionUpdate":"agent_mess',
    ].join('\n'))
    const updates = await readAcpUpdatesFile(file)
    expect(acpUpdatesToTranscriptEvents('s1', updates!).map((e) => e.content)).toEqual([
      [{ type: 'text', text: 'a' }],
      [{ type: 'text', text: 'bc' }],
    ])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when the agent persisted nothing', async () => {
    expect(await readAcpUpdatesFile(path.join(os.tmpdir(), 'missing-acp', 'updates.jsonl'))).toBeNull()
  })
})
