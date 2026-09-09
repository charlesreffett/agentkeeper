import { describe, expect, it } from 'vitest'
import { harnessStreamToTranscriptEvent, sdkMessageToTranscriptEvent } from './sdk-normalize'

describe('harness activity normalization', () => {
  it('preserves Claude thinking and tool blocks', () => {
    const event = sdkMessageToTranscriptEvent({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'thinking', thinking: 'inspect' },
      { type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } },
    ] } })
    expect(event?.content.map((block) => block.type)).toEqual(['thinking', 'tool_use'])
  })

  it('normalizes OpenCode reasoning and tool snapshots through canonical blocks', () => {
    const reasoning = sdkMessageToTranscriptEvent({ type: 'assistant', uuid: 'part-reasoning', message: {
      role: 'assistant', content: [{ type: 'thinking', thinking: 'inspect' }],
    } })
    const tool = sdkMessageToTranscriptEvent({ type: 'assistant', uuid: 'call-1', message: {
      role: 'assistant', content: [{ type: 'tool_use', id: 'call-1', name: 'read', input: { filePath: 'a.ts' } }],
    } })
    expect(reasoning?.uuid).toBe('part-reasoning')
    expect(reasoning?.content[0]?.type).toBe('thinking')
    expect(tool?.content[0]?.type).toBe('tool_use')
  })

  it('normalizes Codex reasoning, commands, file changes, and tools', () => {
    const fixtures = [
      { type: 'reasoning', text: 'think' },
      { type: 'command_execution', command: 'pwd', aggregated_output: '/tmp', exit_code: 0 },
      { type: 'file_change', changes: [{ path: 'a.ts' }], status: 'completed' },
      { type: 'mcp_tool_call', name: 'lookup', arguments: { q: 'x' }, result: 'ok' },
    ]
    const events = fixtures.map((item, index) => harnessStreamToTranscriptEvent({
      type: 'stream_event', provider: 'codex', event: { type: 'item.completed', item: { id: `i${index}`, ...item } },
    }))
    expect(events.map((event) => event?.content[0]?.type)).toEqual(['thinking', 'tool_use', 'tool_use', 'tool_use'])
  })

  it('preserves each Codex file-change operation and path', () => {
    const event = harnessStreamToTranscriptEvent({
      provider: 'codex',
      event: { type: 'item.completed', item: { id: 'change', type: 'file_change', status: 'completed', changes: [
        { path: 'created.txt', kind: 'add' },
        { path: 'edited.txt', kind: 'update' },
        { path: 'deleted.txt', kind: 'delete' },
      ] } },
    })
    const uses = event?.content.filter((block) => block.type === 'tool_use') ?? []
    expect(uses.map((block) => block.name)).toEqual(['Create', 'Edit', 'Delete'])
    expect(uses.map((block) => block.input)).toEqual([
      expect.objectContaining({ file_path: 'created.txt' }),
      expect.objectContaining({ file_path: 'edited.txt' }),
      expect.objectContaining({ file_path: 'deleted.txt' }),
    ])
  })

  for (const provider of ['cursor', 'grok']) {
    it(`normalizes ${provider} ACP thought and tool updates`, () => {
      const thought = harnessStreamToTranscriptEvent({ provider, event: { params: { update: {
        sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' },
      } } } })
      const tool = harnessStreamToTranscriptEvent({ provider, event: { params: { update: {
        sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'Shell', rawInput: { command: 'pwd' }, rawOutput: 'ok', status: 'completed',
      } } } })
      expect(thought?.content[0]?.type).toBe('thinking')
      expect(tool?.content.map((block) => block.type)).toEqual(['tool_use', 'tool_result'])
    })
  }
})
