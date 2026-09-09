import type { HarnessEvent } from '@agentkeeper/core'

/** A resumed harness stream may retain the model metadata from the original
 * process even after AgentKeeper restarts it with a different model. The
 * session's configured model is authoritative for the run that produced the
 * event, so stamp it onto both complete and streaming assistant messages. */
export function withSessionModel(event: HarnessEvent, model?: string): HarnessEvent {
  if (!model) return event

  if (event.type === 'assistant') {
    return { ...event, message: { ...event.message, model } }
  }

  if (event.type === 'stream_event') {
    const streamEvent = event['event']
    if (!streamEvent || typeof streamEvent !== 'object') return event
    const inner = streamEvent as Record<string, unknown>
    if (inner['type'] !== 'message_start') return event
    const message = inner['message']
    if (!message || typeof message !== 'object') return event
    return {
      ...event,
      event: {
        ...inner,
        message: { ...(message as Record<string, unknown>), model },
      },
    }
  }

  return event
}
