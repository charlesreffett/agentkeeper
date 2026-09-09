import { describe, expect, it } from 'vitest'
import type { HarnessEvent } from '@agentkeeper/core'
import { withSessionModel } from './session-event-model'

describe('session event model labels', () => {
  it('uses the configured run model for complete assistant messages', () => {
    const event: HarnessEvent = {
      type: 'assistant',
      message: { role: 'assistant', content: 'hello', model: 'claude-sonnet-5' },
    }

    expect(withSessionModel(event, 'claude-haiku-4-5-20251001')).toMatchObject({
      message: { model: 'claude-haiku-4-5-20251001' },
    })
    expect(event.message.model).toBe('claude-sonnet-5')
  })

  it('uses the configured run model for streaming message headers', () => {
    const event = {
      type: 'stream_event',
      event: { type: 'message_start', message: { model: 'claude-sonnet-5' } },
    } as HarnessEvent

    expect(withSessionModel(event, 'claude-haiku-4-5-20251001')).toMatchObject({
      event: {
        message: { model: 'claude-haiku-4-5-20251001' },
      },
    })
  })

  it('leaves unrelated events and unspecified models alone', () => {
    const event: HarnessEvent = { type: 'result', subtype: 'success' }
    expect(withSessionModel(event, 'claude-haiku-4-5-20251001')).toBe(event)
    expect(withSessionModel(event)).toBe(event)
  })
})
