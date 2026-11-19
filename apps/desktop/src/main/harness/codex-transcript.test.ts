import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeCodexTranscriptEvent, readCodexTranscript } from './codex-transcript'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
})

describe('Codex transcript reader', () => {
  it('normalizes conversational messages and skips commentary', () => {
    expect(normalizeCodexTranscriptEvent({
      timestamp: '2026-09-09T12:00:00Z', type: 'event_msg',
      payload: { type: 'user_message', message: 'Hello' },
    }, 'thread:0')).toMatchObject({ uuid: 'thread:0', role: 'user', content: [{ type: 'text', text: 'Hello' }] })
    expect(normalizeCodexTranscriptEvent({
      type: 'event_msg', payload: { type: 'agent_message', message: 'Working', phase: 'commentary' },
    }, 'thread:1')).toBeNull()
    expect(normalizeCodexTranscriptEvent({
      type: 'event_msg', payload: { type: 'agent_message', message: 'Done', phase: 'final_answer' },
    }, 'thread:2')).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Done' }] })
  })

  it('normalizes current item_completed messages and ignores injected prompt context', () => {
    const item = (item: Record<string, unknown>) => ({ timestamp: '2026-09-09T22:56:06Z', type: 'event_msg', payload: { type: 'item_completed', item } })
    expect(normalizeCodexTranscriptEvent(
      item({ type: 'UserMessage', id: 'item-1', content: [{ type: 'text', text: 'test', text_elements: [] }] }), 't:0',
    )).toMatchObject({ role: 'user', content: [{ type: 'text', text: 'test' }] })
    expect(normalizeCodexTranscriptEvent(
      item({ type: 'AgentMessage', content: [{ type: 'Text', text: 'Ready.' }], phase: 'final_answer' }), 't:1',
    )).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Ready.' }] })
    expect(normalizeCodexTranscriptEvent(
      item({ type: 'AgentMessage', content: [{ type: 'Text', text: 'Looking…' }], phase: 'commentary' }), 't:2',
    )).toBeNull()
    expect(normalizeCodexTranscriptEvent(item({ type: 'CommandExecution' }), 't:3')).toBeNull()
    expect(normalizeCodexTranscriptEvent({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<recommended_plugins>…' }] },
    }, 't:4')).toBeNull()
  })

  it('finds a date-partitioned rollout and restores its conversation', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agentkeeper-codex-transcript-'))
    temporaryRoots.push(root)
    const day = path.join(root, '2026', '09', '09')
    await fs.promises.mkdir(day, { recursive: true })
    const sessionId = '01a08847-7b0e-7f02-a69e-2b80852e8c43'
    const file = path.join(day, `rollout-2026-09-09T12-00-00-${sessionId}.jsonl`)
    await fs.promises.writeFile(file, [
      JSON.stringify({ type: 'session_meta', payload: { cli_version: '1.2.3', git: { branch: 'fix/test' } } }),
      JSON.stringify({ timestamp: '2026-09-09T12:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: 'Test' } }),
      JSON.stringify({ timestamp: '2026-09-09T12:00:02Z', type: 'event_msg', payload: { type: 'agent_message', message: 'Ready', phase: 'final_answer' } }),
    ].join('\n'))

    const transcript = await readCodexTranscript(root, '/workspace/project', sessionId)

    expect(transcript).toMatchObject({ id: sessionId, path: file, gitBranch: 'fix/test', versions: ['1.2.3'] })
    expect(transcript?.events.map((event) => [event.role, event.content[0]])).toEqual([
      ['user', { type: 'text', text: 'Test' }],
      ['assistant', { type: 'text', text: 'Ready' }],
    ])
  })
})
