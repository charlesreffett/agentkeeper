import { describe, expect, it } from 'vitest'
import { extractText, promptForTurn } from './codex'

describe('Codex harness input', () => {
  it('extracts the queued plain-text message used to start a live session', () => {
    expect(extractText('test')).toBe('test')
  })

  it('uses the first queued message instead of the empty live-session prompt', async () => {
    async function* messages() {
      yield { type: 'user' as const, message: { role: 'user' as const, content: 'test' } }
    }

    await expect(promptForTurn('', messages())).resolves.toBe('test')
  })

  it('preserves text blocks around non-text attachments', () => {
    expect(extractText([
      { type: 'text', text: 'Attached context' },
      { type: 'image', source: { type: 'base64', data: 'ignored' } },
      { type: 'text', text: 'Please investigate' },
    ])).toBe('Attached context\nPlease investigate')
  })
})
