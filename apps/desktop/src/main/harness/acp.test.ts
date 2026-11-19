import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const fakeAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-fake-'))
const fakeAgent = path.join(fakeAgentDir, 'fake-acp.js')
fs.writeFileSync(fakeAgent, `#!/usr/bin/env node
const rl = require('node:readline').createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n')
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ id: m.id, result: { authMethods: [] } })
  else if (m.method === 'session/new') send({ id: m.id, result: { sessionId: 's1' } })
  else if (m.method === 'session/load') {
    send({ method: 'session/update', params: { sessionId: m.params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'old reply' } } } })
    send({ id: m.id, result: {} })
  }
  else if (m.method === 'session/prompt') {
    const text = m.params.prompt.map((p) => p.text).join('')
    send({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'echo:' + text } } } })
    send({ id: m.id, result: { stopReason: 'end_turn' } })
  }
})
`, { mode: 0o755 })

vi.mock('./bin', () => ({ resolveBin: () => fakeAgent }))

const { cursorHarness, modelsFromAcp } = await import('./acp')

afterAll(() => fs.rmSync(fakeAgentDir, { recursive: true, force: true }))

describe('ACP prompt delivery', () => {
  it('sends the queued live-session message instead of the empty prompt', async () => {
    async function* messages() {
      yield { type: 'user' as const, message: { role: 'user' as const, content: 'Hi! this is a test' } }
    }
    let result: unknown
    for await (const event of cursorHarness.runSession('', { cwd: fakeAgentDir, messageQueue: messages() })) {
      if (event.type === 'result') result = event.result
    }
    expect(result).toBe('echo:Hi! this is a test')
  })

  it('keeps the resumed session id and drops replayed history on session/load', async () => {
    async function* messages() {
      yield { type: 'user' as const, message: { role: 'user' as const, content: 'again' } }
    }
    const sessionIds: unknown[] = []
    let result: unknown
    for await (const event of cursorHarness.runSession('', { cwd: fakeAgentDir, resume: 'prior-session', messageQueue: messages() })) {
      if (event.type === 'system') sessionIds.push(event.session_id)
      if (event.type === 'result') result = event.result
    }
    expect(sessionIds).toEqual(['prior-session'])
    expect(result).toBe('echo:again')
  })
})

describe('ACP model discovery', () => {
  const fallback = { value: 'default', label: 'Default', provider: 'Cursor', isDefault: true }

  it('normalizes the typed session model state used by Grok', () => {
    expect(modelsFromAcp({
      currentModelId: 'grok-build',
      availableModels: [
        { modelId: 'grok-build', name: 'Grok Build', description: 'Coding agent' },
        { modelId: 'grok-4', name: 'Grok 4' },
      ],
    }, { ...fallback, provider: 'xAI' })).toEqual([
      { value: 'grok-build', label: 'Grok Build', description: 'Coding agent', provider: 'xAI', isDefault: true },
      { value: 'grok-4', label: 'Grok 4', description: undefined, provider: 'xAI', isDefault: false },
    ])
  })

  it('normalizes Cursor list_available_models and preserves its active model', () => {
    expect(modelsFromAcp({
      currentValue: 'gpt-5.4',
      models: [{ value: 'gpt-5.4', name: 'GPT-5.4' }],
    }, fallback)).toEqual([
      { value: 'gpt-5.4', label: 'GPT-5.4', description: undefined, provider: 'Cursor', isDefault: true },
    ])
  })

  it('uses a harness-owned fallback when discovery is unavailable', () => {
    expect(modelsFromAcp({}, fallback)).toEqual([fallback])
  })
})
