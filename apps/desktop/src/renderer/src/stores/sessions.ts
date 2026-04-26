import { defineStore } from 'pinia'
import { computed, reactive, ref, toRaw } from 'vue'
import type {
  LiveSessionStatus,
  PersistedSession,
  RoleEffort,
  StartSessionParams,
  TranscriptEvent,
} from '@shared/ipc-contract'
import { sdkMessageToTranscriptEvent } from '@/lib/sdk-normalize'

export interface LiveSession {
  localId: string
  sdkSessionId: string | null
  /** Logical project the session belongs to (used for sidebar filtering). */
  projectPath: string
  /** Actual cwd given to the SDK — differs from projectPath if a worktree. */
  worktreePath: string | null
  /** Branch name if session runs in a worktree, else null. */
  branch: string | null
  /** Role name applied to this session, if any. */
  roleName: string | null
  /** Agency instance id if this session is part of a running agency. */
  agencyInstanceId: string | null
  /** Agency display name. */
  agencyName: string | null
  initialPrompt: string
  model: string | null
  status: LiveSessionStatus
  events: TranscriptEvent[]
  error: string | null
  startedAt: number
  lastActivityAt: number
  /** Set when this session was created via resume — the historical transcript
   *  is loaded from this sdkSessionId's JSONL and shown above live events. */
  resumedFromSdkSessionId: string | null
  interruptedAt: number | null
}

function plainParams(p: StartSessionParams): StartSessionParams {
  // JSON round-trip strips Vue reactive Proxies at any depth (e.g. allowedTools
  // being a reactive array accessed through a role proxy).
  return JSON.parse(JSON.stringify(toRaw(p))) as StartSessionParams
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

  async function start(
    params: StartSessionParams & {
      branch?: string | null
      roleName?: string | null
    },
  ): Promise<string> {
    const plain = plainParams(params) as StartSessionParams & {
      branch?: string | null
      roleName?: string | null
    }
    const localId = plain.localId ?? cryptoRandomId()

    sessions[localId] = {
      localId,
      sdkSessionId: null,
      projectPath: plain.projectPath,
      worktreePath: plain.worktreePath ?? null,
      branch: plain.branch ?? null,
      roleName: plain.roleName ?? null,
      agencyInstanceId: null,
      agencyName: null,
      initialPrompt: plain.initialPrompt,
      model: plain.model ?? null,
      status: 'starting',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: null,
      interruptedAt: null,
    }
    currentLiveId.value = localId

    // Flush anything that arrived pre-registration (shouldn't happen with
    // pre-supplied localId, but cheap and correct).
    flushBuffer(localId)

    try {
      // `branch` and `roleName` are renderer-only hints; strip before crossing IPC.
      const { branch: _branch, roleName: _roleName, ...startArgs } = plain
      await window.orchestral.sessions.start({ ...startArgs, localId })
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
      s.interruptedAt = null
      s.lastActivityAt = Date.now()
    } catch (err) {
      s.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function interrupt(id: string): Promise<void> {
    const s = sessions[id]
    if (!s) return
    try {
      await window.orchestral.sessions.interrupt(id)
      s.interruptedAt = Date.now()
      s.events.push({
        uuid: crypto.randomUUID(),
        parentUuid: null,
        timestamp: new Date().toISOString(),
        kind: 'system',
        role: 'system',
        isMeta: false,
        isSidechain: false,
        model: null,
        content: [{ type: 'text', text: 'Interrupted.' }],
        parentToolUseId: null,
        systemSubtype: 'interrupted',
      })
    } catch (err) {
      s.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function terminate(id: string): Promise<void> {
    const s = sessions[id]
    if (!s) return
    try {
      await window.orchestral.sessions.terminate(id)
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

  /**
   * Register a session started outside the store (e.g. by the orchestrator
   * as part of an agency). Events/status broadcasts find it by id from then on.
   */
  function registerExternal(entry: {
    localId: string
    projectPath: string
    worktreePath?: string | null
    branch?: string | null
    roleName?: string | null
    agencyInstanceId?: string | null
    agencyName?: string | null
    initialPrompt: string
    model?: string | null
  }): void {
    sessions[entry.localId] = {
      localId: entry.localId,
      sdkSessionId: null,
      projectPath: entry.projectPath,
      worktreePath: entry.worktreePath ?? null,
      branch: entry.branch ?? null,
      roleName: entry.roleName ?? null,
      agencyInstanceId: entry.agencyInstanceId ?? null,
      agencyName: entry.agencyName ?? null,
      initialPrompt: entry.initialPrompt,
      model: entry.model ?? null,
      status: 'starting',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: null,
      interruptedAt: null,
    }
    flushBuffer(entry.localId)
  }

  function clearFocus(): void {
    currentLiveId.value = null
  }

  async function resume(persisted: PersistedSession): Promise<string> {
    const newId = await window.orchestral.sessions.resume(persisted.localId)
    // Register immediately so LiveSessionView can find it. Any broadcasts that
    // arrived before this (buffered) are flushed here.
    if (!sessions[newId]) {
      sessions[newId] = {
        localId: newId,
        sdkSessionId: null,
        projectPath: persisted.projectPath,
        worktreePath: persisted.worktreePath,
        branch: persisted.branch,
        roleName: persisted.roleName,
        agencyInstanceId: persisted.agencyInstanceId,
        agencyName: persisted.agencyName,
        initialPrompt: persisted.initialPrompt,
        model: persisted.model,
        status: 'idle',
        events: [],
        error: null,
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
        resumedFromSdkSessionId: persisted.sdkSessionId,
        interruptedAt: null,
      }
      flushBuffer(newId)
    }
    currentLiveId.value = newId
    return newId
  }

  async function resumeFromHistory(params: {
    sdkSessionId: string
    projectPath: string
    firstMessage: string
    model: string
    effort: RoleEffort
  }): Promise<string> {
    const localId = cryptoRandomId()
    sessions[localId] = {
      localId,
      sdkSessionId: null,
      projectPath: params.projectPath,
      worktreePath: null,
      branch: null,
      roleName: null,
      agencyInstanceId: null,
      agencyName: null,
      initialPrompt: params.firstMessage || '(continued)',
      model: params.model,
      status: 'idle',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: params.sdkSessionId,
      interruptedAt: null,
    }
    currentLiveId.value = localId
    flushBuffer(localId)

    try {
      await window.orchestral.sessions.start({
        localId,
        projectPath: params.projectPath,
        initialPrompt: params.firstMessage || '(continued)',
        model: params.model,
        effort: params.effort,
        resumeSdkSessionId: params.sdkSessionId,
      })
      await window.orchestral.sessions.sendInput(localId, params.firstMessage)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sessions[localId]!.status = 'error'
      sessions[localId]!.error = message
    }
    return localId
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
    interrupt,
    terminate,
    dismiss,
    focus,
    clearFocus,
    registerExternal,
    resume,
    resumeFromHistory,
  }
})
