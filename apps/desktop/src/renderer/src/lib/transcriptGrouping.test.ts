import { describe, expect, it } from 'vitest'
import type { ContentBlock, TranscriptEvent } from '@shared/ipc-contract'
import { activityGroupLabel, groupTranscript, type ActivityGroup } from './transcriptGrouping'

let sequence = 0
function event(role: 'user' | 'assistant' | 'system', content: ContentBlock[], extra: Partial<TranscriptEvent> = {}): TranscriptEvent {
  sequence += 1
  return {
    uuid: `event-${sequence}`, parentUuid: null, timestamp: new Date(sequence * 1000).toISOString(),
    kind: role, role, isMeta: false, isSidechain: false, model: null, content,
    parentToolUseId: null, systemSubtype: null, ...extra,
  }
}

describe('groupTranscript', () => {
  it('keeps commands attached to the thought that preceded them', () => {
    const grouped = groupTranscript([
      event('user', [{ type: 'text', text: 'do it' }]),
      event('assistant', [{ type: 'text', text: 'First thought' }]),
      event('assistant', [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'one' } }]),
      event('user', [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }]),
      event('assistant', [{ type: 'text', text: 'Second thought' }]),
      event('assistant', [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'two' } }]),
      event('assistant', [{ type: 'text', text: 'Finished' }]),
    ])
    const turn = grouped.find((item) => item.type === 'turn')
    expect(turn?.type).toBe('turn')
    if (turn?.type !== 'turn') return
    expect(turn.turn.phases).toHaveLength(2)
    expect(turn.turn.phases.map((phase) => phase.groups[0]?.items[0]?.id)).toEqual(['a', 'b'])
    expect(turn.turn.finalEvent?.content).toEqual([{ type: 'text', text: 'Finished' }])
  })

  it('keeps adjacent file and command groups independently expandable', () => {
    const grouped = groupTranscript([
      event('user', [{ type: 'text', text: 'inspect' }]),
      event('assistant', [
        { type: 'thinking', thinking: 'I will inspect and test.' },
        { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'a.ts' } },
        { type: 'tool_use', id: 'run', name: 'Bash', input: { command: 'pnpm test' } },
      ]),
      event('assistant', [{ type: 'text', text: 'Done' }]),
    ])
    const turn = grouped[1]
    expect(turn?.type).toBe('turn')
    if (turn?.type !== 'turn') return
    expect(turn.turn.phases[0]?.groups.map((group) => group.category)).toEqual(['files', 'commands'])
  })

  it('keeps current assistant text inside an active work group', () => {
    const grouped = groupTranscript([
      event('user', [{ type: 'text', text: 'go' }]),
      event('assistant', [{ type: 'text', text: 'I am checking.' }]),
    ], true)
    const turn = grouped[1]
    expect(turn?.type).toBe('turn')
    if (turn?.type !== 'turn') return
    expect(turn.turn.finalEvent).toBeNull()
    expect(turn.turn.phases[0]?.narrative).toHaveLength(1)
  })

  it('does not reorder a thought before an action when a turn ends without a final answer', () => {
    const grouped = groupTranscript([
      event('user', [{ type: 'text', text: 'go' }]),
      event('assistant', [{ type: 'text', text: 'I will try this.' }]),
      event('assistant', [{ type: 'tool_use', id: 'failed', name: 'Bash', input: { command: 'false' } }]),
      event('user', [{ type: 'tool_result', tool_use_id: 'failed', content: 'failed', is_error: true }]),
    ])
    const turn = grouped[1]
    expect(turn?.type).toBe('turn')
    if (turn?.type !== 'turn') return
    expect(turn.turn.finalEvent).toBeNull()
    expect(turn.turn.phases[0]?.narrative[0]?.block).toMatchObject({ type: 'text', text: 'I will try this.' })
  })

  it('surfaces system events within the chronological phase', () => {
    const grouped = groupTranscript([
      event('user', [{ type: 'text', text: 'go' }]),
      event('system', [], { systemSubtype: 'interrupted' }),
    ])
    const turn = grouped[1]
    expect(turn?.type).toBe('turn')
    if (turn?.type !== 'turn') return
    expect(turn.turn.phases[0]?.groups[0]?.category).toBe('system')
  })
})

describe('activityGroupLabel', () => {
  function group(...blocks: Array<Extract<ContentBlock, { type: 'tool_use' }>>): ActivityGroup {
    return {
      id: 'group', category: 'files',
      items: blocks.map((block) => ({ id: block.id, event: event('assistant', [block]), block, category: 'files' })),
    }
  }

  it('names a single file operation and target precisely', () => {
    expect(activityGroupLabel(group({ type: 'tool_use', id: '1', name: 'Create', input: { file_path: 'test.txt' } }))).toBe('Created test.txt')
    expect(activityGroupLabel(group({ type: 'tool_use', id: '2', name: 'Edit', input: { file_path: 'test.txt' } }))).toBe('Edited test.txt')
    expect(activityGroupLabel(group({ type: 'tool_use', id: '3', name: 'Delete', input: { file_path: 'test.txt' } }))).toBe('Deleted test.txt')
  })

  it('summarizes repeated and mixed file operations without ambiguity', () => {
    expect(activityGroupLabel(group(
      { type: 'tool_use', id: '1', name: 'Read', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: '2', name: 'Read', input: { file_path: 'b.ts' } },
    ))).toBe('Read 2 files')
    expect(activityGroupLabel(group(
      { type: 'tool_use', id: '3', name: 'Create', input: { file_path: 'a.ts' } },
      { type: 'tool_use', id: '4', name: 'Edit', input: { file_path: 'b.ts' } },
    ))).toBe('Created 1 file, edited 1 file')
  })
})
