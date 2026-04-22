import { defineStore } from 'pinia'
import { computed, reactive, ref, toRaw } from 'vue'
import type {
  LiveSessionStatus,
  StartSessionParams,
  TranscriptEvent,
} from '@shared/ipc-contract'
import { sdkMessageToTranscriptEvent } from '@/lib/sdk-normalize'

export interface LiveSession {
  localId: string
  sdkSessionId: string | null
  projectPath: string
  initialPrompt: string
  model: string | null
  status: LiveSessionStatus
  events: TranscriptEvent[]
  error: string | null
  startedAt: number
  lastActivityAt: number
}

function plainParams(p: StartSessionParams): StartSessionParams {
  return { ...toRaw(p) }
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const useSessionStore = defineStore('sessions', () => {
  // reactive() dict so sub-property mutations trigger updates
  const sessions = reactive<Record<string, LiveSession>>({})
  const currentLiveId = ref<string | null>(null)

  // Buffer for status/event payloads that arrive before the session is
  // registered in the store (race between main broadcasting init status
  // and renderer adding the session after start() resolves).
  const buffered = reactive<
    Record<
      string,
      {
        events: TranscriptEvent[]
        status: LiveSessionStatus | null
        sdkSessionId: string | null
        error: string | null
      }
    >
  >({})

  function ensureBuffer(id: string) {
    if (!buffered[id]) {
      buffered[id] = {
        events: [],
        status: null,
        sdkSessionId: null,
        error: null,
      }
    }
    return buffered[id]!
  }

  function flushBuffer(id: string) {
    const buf = buffered[id]
    const s = sessions[id]
    if (!buf || !s) return
    if (buf.events.length) s.events.push(...buf.events)
    if (buf.status) s.status = buf.status
    if (buf.sdkSessionId) s.sdkSessionId = buf.sdkSessionId
    if (buf.error) s.error = buf.error
    delete buffered[id]
  }

  const liveList = computed(() =>
    Object.values(sessions).sort((a, b) => b.lastActivityAt - a.lastActivityAt),
  )

  const currentSession = computed(() =>
    currentLiveId.value ? (sessions[currentLiveId.value] ?? null) : null,
  )

  function getSession(id: string): LiveSession | null {
    return sessions[id] ?? null
  }

  async function start(params: StartSessionParams): Promise<string> {
    const plain = plainParams(params)
    const localId = plain.localId ?? cryptoRandomId()

    sessions[localId] = {
      localId,
      sdkSessionId: null,
      projectPath: plain.projectPath,
      initialPrompt: plain.initialPrompt,
      model: plain.model ?? null,
      status: 'starting',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    }
    currentLiveId.value = localId

    // Flush anything that arrived pre-registration (shouldn't happen with
    // pre-supplied localId, but cheap and correct).
    flushBuffer(localId)

    try {
      await window.orchestral.sessions.start({ ...plain, localId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sessions[localId]!.status = 'error'
      sessions[localId]!.error = message
    }
    return localId
  }

  async function send(id: string, text: string): Promise<void> {
    const s = sessions[id]
    if (!s) return
    try {
      await window.orchestral.sessions.sendInput(id, text)
      s.lastActivityAt = Date.now()
    } catch (err) {
      s.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function cancel(id: string): Promise<void> {
    const s = sessions[id]
    if (!s) return
    try {
      await window.orchestral.sessions.cancel(id)
    } catch (err) {
      s.error = err instanceof Error ? err.message : String(err)
    }
  }

  function dismiss(id: string): void {
    delete sessions[id]
    if (currentLiveId.value === id) currentLiveId.value = null
  }

  function focus(id: string): void {
    if (!sessions[id]) return
    currentLiveId.value = id
  }

  function clearFocus(): void {
    currentLiveId.value = null
  }

  // ─── IPC subscriptions — set up once ───────────────────────────────────

  window.orchestral.sessions.onEvent((payload) => {
    const evt = sdkMessageToTranscriptEvent(payload.message)
    if (!evt) return
    const s = sessions[payload.sessionId]
    if (s) {
      s.events.push(evt)
      s.lastActivityAt = Date.now()
    } else {
      ensureBuffer(payload.sessionId).events.push(evt)
    }
  })

  window.orchestral.sessions.onStatus((update) => {
    const s = sessions[update.sessionId]
    if (s) {
      s.status = update.status
      if (update.sdkSessionId) s.sdkSessionId = update.sdkSessionId
      if (update.error) s.error = update.error
      s.lastActivityAt = Date.now()
    } else {
      const buf = ensureBuffer(update.sessionId)
      buf.status = update.status
      if (update.sdkSessionId) buf.sdkSessionId = update.sdkSessionId
      if (update.error) buf.error = update.error
    }
  })

  return {
    sessions,
    liveList,
    currentLiveId,
    currentSession,
    getSession,
    start,
    send,
    cancel,
    dismiss,
    focus,
    clearFocus,
  }
})
