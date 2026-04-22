import { onUnmounted, ref, shallowRef } from 'vue'
import type {
  LiveSessionStatus,
  StartSessionParams,
  TranscriptEvent,
} from '@shared/ipc-contract'
import { sdkMessageToTranscriptEvent } from '@/lib/sdk-normalize'

export function useLiveSession() {
  const sessionId = ref<string | null>(null)
  const sdkSessionId = ref<string | null>(null)
  const status = ref<LiveSessionStatus>('starting')
  const events = shallowRef<TranscriptEvent[]>([])
  const error = ref<string | null>(null)

  const unsubEvent = window.orchestral.sessions.onEvent((payload) => {
    if (payload.sessionId !== sessionId.value) return
    const evt = sdkMessageToTranscriptEvent(payload.message)
    if (evt) events.value = [...events.value, evt]
  })

  const unsubStatus = window.orchestral.sessions.onStatus((update) => {
    if (update.sessionId !== sessionId.value) return
    status.value = update.status
    if (update.sdkSessionId) sdkSessionId.value = update.sdkSessionId
    if (update.error) error.value = update.error
  })

  async function start(params: StartSessionParams): Promise<void> {
    events.value = []
    error.value = null
    status.value = 'starting'
    sdkSessionId.value = null
    try {
      const id = await window.orchestral.sessions.start(params)
      sessionId.value = id
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      status.value = 'error'
    }
  }

  async function send(text: string): Promise<void> {
    if (!sessionId.value) return
    try {
      await window.orchestral.sessions.sendInput(sessionId.value, text)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function cancel(): Promise<void> {
    if (!sessionId.value) return
    try {
      await window.orchestral.sessions.cancel(sessionId.value)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  onUnmounted(() => {
    unsubEvent()
    unsubStatus()
    if (
      sessionId.value &&
      (status.value === 'running' ||
        status.value === 'idle' ||
        status.value === 'starting')
    ) {
      void window.orchestral.sessions.cancel(sessionId.value)
    }
  })

  return {
    sessionId,
    sdkSessionId,
    status,
    events,
    error,
    start,
    send,
    cancel,
  }
}
