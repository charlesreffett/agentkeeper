import { defineStore } from 'pinia'
import { computed, reactive, ref, toRaw, watch } from 'vue'
import type {
  Agency,
  Attachment,
  LiveSessionStatus,
  PermissionMode,
  PersistedAgency,
  PersistedSession,
  Role,
  RoleEffort,
  StartSessionParams,
  TranscriptEvent,
} from '@shared/ipc-contract'
import { sdkMessageToTranscriptEvent } from '@/lib/sdk-normalize'

/** Renderer-only configuration captured while a session is still a draft. */
export interface DraftSessionConfig {
  /** 'scope:id' of selected agency, or '' for none (plain session). */
  agencyKey: string
  /** Selected role id, or '' for freeform. Ignored when agencyKey is set. */
  roleId: string
  useWorktree: boolean
  branch: string
  branchTouched: boolean
  effortTouched: boolean
}

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
  agencyPrompt: string | null
  title: string | null
  model: string | null
  effort: RoleEffort | null
  permissionMode: PermissionMode | null
  status: LiveSessionStatus
  events: TranscriptEvent[]
  error: string | null
  startedAt: number
  lastActivityAt: number
  /** Set when this session was created via resume — the historical transcript
   *  is loaded from this sdkSessionId's JSONL and shown above live events. */
  resumedFromSdkSessionId: string | null
  interruptedAt: number | null
  workItemKey: string | null
  workItemTitle: string | null
  /** Renderer-only: not yet started in main. The next user message promotes it. */
  isDraft: boolean
  draftConfig: DraftSessionConfig | null
  draftMessage: string
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
  interface DayUsage {
    tokens: number
    costUsd: number
  }

  function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const dailyUsage = reactive<Record<string, DayUsage>>({})

  // Authoritative counts pushed from main at the end of each query turn.
  const activeAgentCount = ref(0)
  const runningSessionCount = ref(0)

  // One-time migration from old usageLog format
  const oldLog = localStorage.getItem('agentkeeper:usageLog')
  if (oldLog && !localStorage.getItem('agentkeeper:dailyUsage')) {
    try {
      const entries = JSON.parse(oldLog) as Array<{ tokens: number; costUsd: number; timestamp: number }>
      for (const e of entries) {
        const key = localDateKey(new Date(e.timestamp))
        if (!dailyUsage[key]) dailyUsage[key] = { tokens: 0, costUsd: 0 }
        dailyUsage[key].tokens += e.tokens
        dailyUsage[key].costUsd += e.costUsd
      }
      localStorage.removeItem('agentkeeper:usageLog')
      localStorage.setItem('agentkeeper:dailyUsage', JSON.stringify(toRaw(dailyUsage)))
    } catch { /* ignore corrupt data */ }
  } else {
    const saved = localStorage.getItem('agentkeeper:dailyUsage')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Record<string, DayUsage>
        const cutoff = new Date()
        cutoff.setDate(cutoff.getDate() - 31)
        const cutoffKey = localDateKey(cutoff)
        for (const [k, v] of Object.entries(parsed)) {
          if (k >= cutoffKey) dailyUsage[k] = v
        }
      } catch { /* ignore corrupt data */ }
    }
  }

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
      agencyPrompt: null,
      title: null,
      model: plain.model ?? null,
      effort: plain.effort ?? null,
      permissionMode: plain.permissionMode ?? null,
      status: 'starting',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: null,
      interruptedAt: null,
      workItemKey: plain.workItemKey ?? null,
      workItemTitle: plain.workItemTitle ?? null,
      isDraft: false,
      draftConfig: null,
      draftMessage: localStorage.getItem(`agentkeeper:draft:${localId}`) ?? '',
    }
    currentLiveId.value = localId

    // Flush anything that arrived pre-registration (shouldn't happen with
    // pre-supplied localId, but cheap and correct).
    flushBuffer(localId)

    try {
      // `branch` and `roleName` are renderer-only hints; strip before crossing IPC.
      const { branch: _branch, roleName: _roleName, ...startArgs } = plain
      await window.agentkeeper.sessions.start({ ...startArgs, localId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sessions[localId]!.status = 'error'
      sessions[localId]!.error = message
    }
    return localId
  }

  async function send(id: string, text: string, attachments?: Attachment[]): Promise<void> {
    const s = sessions[id]
    if (!s) return
    try {
      await window.agentkeeper.sessions.sendInput(id, text, attachments)
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
      await window.agentkeeper.sessions.interrupt(id)
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
      await window.agentkeeper.sessions.terminate(id)
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
    agencyPrompt?: string | null
    model?: string | null
    effort?: RoleEffort | null
    permissionMode?: PermissionMode | null
    workItemKey?: string | null
    workItemTitle?: string | null
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
      agencyPrompt: entry.agencyPrompt ?? null,
      title: null,
      model: entry.model ?? null,
      effort: entry.effort ?? null,
      permissionMode: entry.permissionMode ?? null,
      status: 'starting',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: null,
      interruptedAt: null,
      workItemKey: entry.workItemKey ?? null,
      workItemTitle: entry.workItemTitle ?? null,
      isDraft: false,
      draftConfig: null,
      draftMessage: localStorage.getItem(`agentkeeper:draft:${entry.localId}`) ?? '',
    }
    flushBuffer(entry.localId)
  }

  function clearFocus(): void {
    currentLiveId.value = null
  }

  function openPersisted(persisted: PersistedSession): string {
    const localId = persisted.localId
    if (!sessions[localId]) {
      sessions[localId] = {
        localId,
        sdkSessionId: null,
        projectPath: persisted.projectPath,
        worktreePath: persisted.worktreePath,
        branch: persisted.branch,
        roleName: persisted.roleName,
        agencyInstanceId: persisted.agencyInstanceId,
        agencyName: persisted.agencyName,
        initialPrompt: persisted.initialPrompt,
        agencyPrompt: null,
        title: persisted.title ?? null,
        model: persisted.model,
        effort: persisted.effort as RoleEffort | null,
        permissionMode: persisted.permissionMode,
        status: 'idle',
        events: [],
        error: null,
        startedAt: persisted.startedAt,
        lastActivityAt: persisted.lastActivityAt,
        resumedFromSdkSessionId: persisted.sdkSessionId,
        interruptedAt: null,
        workItemKey: persisted.workItemKey,
        workItemTitle: persisted.workItemTitle,
        isDraft: false,
        draftConfig: null,
        draftMessage: localStorage.getItem(`agentkeeper:draft:${localId}`) ?? '',
      }
      flushBuffer(localId)
    }
    currentLiveId.value = localId
    return localId
  }

  function openPersistedAgency(
    agency: PersistedAgency,
    memberSessions: PersistedSession[],
  ): string {
    for (const s of memberSessions) {
      if (!sessions[s.localId]) {
        sessions[s.localId] = {
          localId: s.localId,
          sdkSessionId: null,
          projectPath: s.projectPath,
          worktreePath: s.worktreePath,
          branch: s.branch,
          roleName: s.roleName,
          agencyInstanceId: s.agencyInstanceId,
          agencyName: s.agencyName,
          initialPrompt: s.initialPrompt,
          agencyPrompt: null,
          title: s.title ?? null,
          model: s.model,
          effort: s.effort as RoleEffort | null,
          permissionMode: s.permissionMode,
          status: 'idle',
          events: [],
          error: null,
          startedAt: s.startedAt,
          lastActivityAt: s.lastActivityAt,
          resumedFromSdkSessionId: s.sdkSessionId,
          interruptedAt: null,
          workItemKey: s.workItemKey,
          workItemTitle: s.workItemTitle,
          isDraft: false,
          draftConfig: null,
          draftMessage: localStorage.getItem(`agentkeeper:draft:${s.localId}`) ?? '',
        }
        flushBuffer(s.localId)
      }
    }
    // Entry session = the one with the user's actual task (not an agency init placeholder).
    // The orchestrator uses "Agency ... is initializing..." / "Agency ... resumed..." for non-entry.
    const entry =
      memberSessions.find((s) => !s.initialPrompt.startsWith('Agency "')) ?? memberSessions[0]
    if (entry) currentLiveId.value = entry.localId
    return entry?.localId ?? ''
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
      agencyPrompt: null,
      title: null,
      model: params.model,
      effort: params.effort,
      permissionMode: null,
      status: 'idle',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: params.sdkSessionId,
      interruptedAt: null,
      workItemKey: null,
      workItemTitle: null,
      isDraft: false,
      draftConfig: null,
      draftMessage: localStorage.getItem(`agentkeeper:draft:${localId}`) ?? '',
    }
    currentLiveId.value = localId
    flushBuffer(localId)

    try {
      await window.agentkeeper.sessions.start({
        localId,
        projectPath: params.projectPath,
        initialPrompt: params.firstMessage || '(continued)',
        model: params.model,
        effort: params.effort,
        resumeSdkSessionId: params.sdkSessionId,
      })
      await window.agentkeeper.sessions.sendInput(localId, params.firstMessage)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      sessions[localId]!.status = 'error'
      sessions[localId]!.error = message
    }
    return localId
  }

  // ─── Drafts ──────────────────────────────────────────────────────────────

  /** Find an existing draft for the project, or create a new one. Focuses it. */
  function createOrFocusDraft(params: {
    projectPath: string
    defaultModel: string
    defaultEffort: RoleEffort
    defaultUseWorktree: boolean
  }): string {
    const existing = Object.values(sessions).find(
      (s) => s.isDraft && s.projectPath === params.projectPath,
    )
    if (existing) {
      currentLiveId.value = existing.localId
      return existing.localId
    }
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
      initialPrompt: '',
      agencyPrompt: null,
      title: null,
      model: params.defaultModel,
      effort: params.defaultEffort,
      permissionMode: 'bypassPermissions',
      status: 'idle',
      events: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      resumedFromSdkSessionId: null,
      interruptedAt: null,
      workItemKey: null,
      workItemTitle: null,
      isDraft: true,
      draftConfig: {
        agencyKey: '',
        roleId: '',
        useWorktree: params.defaultUseWorktree,
        branch: '',
        branchTouched: false,
        effortTouched: false,
      },
      draftMessage: localStorage.getItem(`agentkeeper:draft:${localId}`) ?? '',
    }
    currentLiveId.value = localId
    return localId
  }

  function setDraftMessage(localId: string, text: string): void {
    const s = sessions[localId]
    if (!s) return
    s.draftMessage = text
    // Persist so the draft survives an app restart.
    const key = `agentkeeper:draft:${localId}`
    if (text) {
      localStorage.setItem(key, text)
    } else {
      localStorage.removeItem(key)
    }
  }

  /**
   * Promote a draft into a live session by sending its first message.
   * For agency drafts: dismisses the draft and registers the agency's sessions.
   * For plain drafts: updates the same entry in-place and starts the SDK session.
   * Returns the focused session id (entry-point for agencies, the same id otherwise).
   */
  async function promoteDraft(
    localId: string,
    prompt: string,
    ctx: { roles: Role[]; agencies: Agency[] },
  ): Promise<string> {
    const draft = sessions[localId]
    if (!draft || !draft.isDraft || !draft.draftConfig) {
      throw new Error('Not a draft session')
    }
    const cfg = draft.draftConfig
    const projectPath = draft.projectPath
    const trimmedPrompt = prompt.trim()

    if (cfg.agencyKey) {
      const agency = ctx.agencies.find((a) => `${a.scope}:${a.id}` === cfg.agencyKey)
      if (!agency) throw new Error('Selected agency not found')
      const instance = await window.agentkeeper.agencies.start({
        projectPath,
        agencyId: agency.id,
        agencyScope: agency.scope,
        initialPrompt: trimmedPrompt,
        useWorktree: cfg.useWorktree,
        ...(cfg.useWorktree && cfg.branch.trim() ? { branch: cfg.branch.trim() } : {}),
        ...(draft.model ? { model: draft.model } : {}),
      })
      delete sessions[localId]
      let entryLocalId: string | null = null
      for (const s of instance.sessions) {
        const role = ctx.roles.find((r) => r.id === s.roleId) ?? null
        registerExternal({
          localId: s.localId,
          projectPath: instance.projectPath,
          worktreePath: instance.worktreePath,
          branch: instance.branch,
          roleName: s.roleName,
          agencyInstanceId: instance.instanceId,
          agencyName: instance.agencyName,
          initialPrompt: s.isEntryPoint ? trimmedPrompt : '(awaiting peers)',
          agencyPrompt: trimmedPrompt,
          model: role?.model ?? draft.model,
        })
        if (s.isEntryPoint) entryLocalId = s.localId
      }
      const focusId = entryLocalId ?? instance.sessions[0]?.localId ?? null
      if (focusId) currentLiveId.value = focusId
      return focusId ?? localId
    }

    let worktreePath: string | undefined
    let branch: string | undefined
    if (cfg.useWorktree && cfg.branch.trim()) {
      const wt = await window.agentkeeper.worktrees.create(projectPath, cfg.branch.trim())
      worktreePath = wt.path
      branch = wt.branch
    }

    const role = cfg.roleId ? (ctx.roles.find((r) => r.id === cfg.roleId) ?? null) : null

    draft.isDraft = false
    draft.draftConfig = null
    draft.worktreePath = worktreePath ?? null
    draft.branch = branch ?? null
    draft.roleName = role?.name ?? null
    draft.initialPrompt = trimmedPrompt
    draft.status = 'starting'
    draft.lastActivityAt = Date.now()

    const startArgs: StartSessionParams = {
      localId,
      projectPath,
      ...(worktreePath ? { worktreePath } : {}),
      ...(role?.systemPrompt ? { systemPromptAppend: role.systemPrompt } : {}),
      ...(role?.allowedTools && role.allowedTools.length ? { allowedTools: role.allowedTools } : {}),
      initialPrompt: trimmedPrompt,
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
      ...(draft.permissionMode ? { permissionMode: draft.permissionMode } : {}),
      ...(role?.name ? { roleName: role.name } : {}),
    }

    try {
      await window.agentkeeper.sessions.start(plainParams(startArgs))
    } catch (err) {
      draft.status = 'error'
      draft.error = err instanceof Error ? err.message : String(err)
    }
    return localId
  }

  // ─── Derived state for global Sessions page ──────────────────────────────

  const visibleSessions = computed<LiveSession[]>(() => {
    const seenAgencies = new Set<string>()
    const result: LiveSession[] = []

    const sorted = Object.values(sessions).sort((a, b) => b.lastActivityAt - a.lastActivityAt)

    for (const s of sorted) {
      if (s.isDraft) continue
      if (s.status === 'completed' || s.status === 'terminated') continue
      if (s.agencyInstanceId) {
        if (s.initialPrompt.startsWith('Agency "')) continue
        if (seenAgencies.has(s.agencyInstanceId)) continue
        seenAgencies.add(s.agencyInstanceId)
      }
      result.push(s)
    }

    return result
  })

  const statusCounts = computed(() => {
    const counts = { running: 0, blocked: 0, idle: 0 }
    for (const s of visibleSessions.value) {
      if (s.status === 'running' || s.status === 'starting') counts.running++
      else if (s.status === 'blocked') counts.blocked++
      else counts.idle++
    }
    return counts
  })

  function subAgentCount(session: LiveSession): number {
    if (!session.agencyInstanceId) return 1
    return Object.values(sessions).filter(
      (s) => s.agencyInstanceId === session.agencyInstanceId,
    ).length
  }

  const tokenStats = computed(() => {
    const todayKey = localDateKey()
    const today = dailyUsage[todayKey] ?? { tokens: 0, costUsd: 0 }
    const now = new Date()
    const history: Array<{ date: string; tokens: number; costUsd: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = localDateKey(d)
      history.push({ date: key, tokens: dailyUsage[key]?.tokens ?? 0, costUsd: dailyUsage[key]?.costUsd ?? 0 })
    }
    return {
      tokensToday: today.tokens,
      costUsdToday: today.costUsd,
      dailyHistory: history,
    }
  })

  // ─── IPC subscriptions — set up once ───────────────────────────────────

  window.agentkeeper.sessions.onEvent((payload) => {
    const evt = sdkMessageToTranscriptEvent(payload.message)
    if (!evt) return
    const s = sessions[payload.sessionId]
    if (s) {
      s.events.push(evt)
      s.lastActivityAt = Date.now()
      if (evt.role === 'assistant') {
        const hasAskUser = evt.content.some(
          (b) => b.type === 'tool_use' && b.name.toLowerCase().replace(/[_-]/g, '') === 'askuser',
        )
        if (hasAskUser) s.status = 'blocked'
      }
    } else {
      ensureBuffer(payload.sessionId).events.push(evt)
    }
  })

  window.agentkeeper.sessions.onStats((stats) => {
    activeAgentCount.value = stats.activeSessionCount
    runningSessionCount.value = stats.runningSessionCount
    const u = stats.turnUsage
    const tokens = u.inputTokens + u.outputTokens
    const costUsd = u.totalCostUsd
    if (tokens > 0 || costUsd > 0) {
      const key = localDateKey()
      if (!dailyUsage[key]) dailyUsage[key] = { tokens: 0, costUsd: 0 }
      dailyUsage[key].tokens += tokens
      dailyUsage[key].costUsd += costUsd
      localStorage.setItem('agentkeeper:dailyUsage', JSON.stringify(toRaw(dailyUsage)))
    }
  })

  window.agentkeeper.sessions.onStatus((update) => {
    const s = sessions[update.sessionId]
    if (s) {
      if (update.status != null) {
        // 'blocked' is renderer-derived — only clear it when the session resumes or ends,
        // not when the SDK reports idle (agent finished its turn while still awaiting input)
        const preserveBlocked =
          s.status === 'blocked' &&
          (update.status === 'idle' || update.status === 'starting')
        if (!preserveBlocked) {
          s.status = update.status
        }
      }
      if (update.sdkSessionId) s.sdkSessionId = update.sdkSessionId
      if (update.error) s.error = update.error
      if (update.title) s.title = update.title
      s.lastActivityAt = Date.now()
    } else {
      const buf = ensureBuffer(update.sessionId)
      if (update.status != null) buf.status = update.status
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
    openPersisted,
    openPersistedAgency,
    resumeFromHistory,
    createOrFocusDraft,
    setDraftMessage,
    promoteDraft,
    visibleSessions,
    statusCounts,
    subAgentCount,
    tokenStats,
    activeAgentCount,
    runningSessionCount,
  }
})
