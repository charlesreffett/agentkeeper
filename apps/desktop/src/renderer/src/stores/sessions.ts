import { defineStore } from 'pinia'
import { computed, reactive, ref, toRaw, watch } from 'vue'
import type {
  Agency,
  Attachment,
  LiveSessionStatus,
  PermissionMode,
  Role,
  RoleEffort,
  Session,
  SessionSummary,
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

export interface LiveSession extends Session {
  // Runtime-only — not persisted, not IPC-transferable
  events: TranscriptEvent[]
  error: string | null
  agencyPrompt: string | null
  resumedFromSdkSessionId: string | null
  interruptedAt: number | null
  isDraft: boolean
  draftConfig: DraftSessionConfig | null
  draftMessage: string
  draftAttachments: Attachment[]
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

async function loadDraft(localId: string): Promise<{ text: string; attachments: Attachment[] }> {
  try {
    return await window.agentkeeper.drafts.get(localId)
  } catch {
    return { text: '', attachments: [] }
  }
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

  // Per-session token/cost accumulator — keyed by localId, cleared on dismiss.
  // Populated from `onStats` (each completed turn) and persisted to localStorage
  // so it survives navigation and full app restarts.
  const sessionTokens = reactive<Record<string, {
    tokens: number
    costUsd: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    inputCostUsd: number
    outputCostUsd: number
    cacheReadCostUsd: number
    cacheCreationCostUsd: number
  }>>({})

  // Per-session assistant-turn counter — incremented on each onStats (one per turn).
  const sessionTurns = reactive<Record<string, number>>({})

  // In-progress token count for the currently executing SDK run — keyed by localId.
  // Reset to 0 on `result` (onStats), at which point sessionTokens is authoritative.
  const sessionRunTokens = reactive<Record<string, number>>({})

  // Bootstrap per-session stats from SQLite. First run: export localStorage keys
  // to main (one-time migration), then always use SQLite going forward.
  void (async () => {
    try {
      // One-time migration: export localStorage stok/sturn/srun to SQLite
      const alreadyImported = localStorage.getItem('agentkeeper:statsImported')
      if (!alreadyImported) {
        const toImport: Array<{
          sessionLocalId: string; totalTokens: number; totalCostUsd: number;
          turnCount: number; inProgressTokens: number;
          inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number;
          inputCostUsd: number; outputCostUsd: number; cacheReadCostUsd: number; cacheCreationCostUsd: number
        }> = []
        for (const key of Object.keys(localStorage)) {
          if (!key.startsWith('agentkeeper:stok:')) continue
          const id = key.slice('agentkeeper:stok:'.length)
          try {
            const raw = localStorage.getItem(key)
            if (!raw) continue
            const data = JSON.parse(raw) as Record<string, unknown>
            const tokens = typeof data['tokens'] === 'number' ? data['tokens'] : 0
            const costUsd = typeof data['costUsd'] === 'number' ? data['costUsd'] : 0
            const turnRaw = localStorage.getItem(`agentkeeper:sturn:${id}`)
            const turnCount = turnRaw !== null ? parseInt(turnRaw, 10) : 0
            toImport.push({ sessionLocalId: id, totalTokens: tokens, totalCostUsd: costUsd, turnCount: isNaN(turnCount) ? 0 : turnCount, inProgressTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 })
          } catch { /* ignore corrupt entries */ }
        }
        if (toImport.length > 0) {
          await window.agentkeeper.stats.importLegacy(toImport)
        }
        // Clean up old localStorage keys
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('agentkeeper:stok:') || key.startsWith('agentkeeper:sturn:') || key.startsWith('agentkeeper:srun:')) {
            localStorage.removeItem(key)
          }
        }
        localStorage.setItem('agentkeeper:statsImported', '1')
      }

      // Load all stats from SQLite
      const rows = await window.agentkeeper.stats.getAll()
      for (const row of rows) {
        if (row.totalTokens > 0 || row.totalCostUsd > 0) {
          sessionTokens[row.sessionLocalId] = {
            tokens: row.totalTokens,
            costUsd: row.totalCostUsd,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheCreationTokens: row.cacheCreationTokens,
            inputCostUsd: row.inputCostUsd,
            outputCostUsd: row.outputCostUsd,
            cacheReadCostUsd: row.cacheReadCostUsd,
            cacheCreationCostUsd: row.cacheCreationCostUsd,
          }
        }
        if (row.turnCount > 0) sessionTurns[row.sessionLocalId] = row.turnCount
        if (row.inProgressTokens > 0) sessionRunTokens[row.sessionLocalId] = row.inProgressTokens
      }
    } catch { /* non-fatal — UI will populate once onStats fires */ }
  })()

  // Real-time output token estimate built from content_block_delta text chunks
  // (~4 chars per token). Zeroed on message_start (new response begins) and on
  // message_delta (actual output_tokens land in sessionRunTokens). This gives
  // a smoothly incrementing counter during streaming rather than a single jump
  // at the end of each turn.
  const sessionOutputEstimates = reactive<Record<string, number>>({})

  // Authoritative counts pushed from main at the end of each query turn.
  const activeAgentCount = ref(0)
  const runningSessionCount = ref(0)

  // Load persisted daily costs from main-process ledger on startup.
  // This runs async; until it resolves dailyUsage starts empty (then fills in).
  void window.agentkeeper.costs.getDailySummary().then(async (rows) => {
    for (const row of rows) {
      dailyUsage[row.date] = { tokens: row.tokens, costUsd: row.costUsd }
    }

    // One-time migration: import per-day totals that were stored in localStorage
    // by the pre-ledger code (removed in commit 05e8021). localStorage stops
    // updating at renderer hot-reload; ledger starts at main-process restart —
    // the two windows are mutually exclusive so adding them is safe.
    if (!localStorage.getItem('agentkeeper:legacyImported')) {
      const legacy = localStorage.getItem('agentkeeper:dailyUsage')
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy) as Record<string, DayUsage>
          const toImport: Array<{ date: string; tokens: number; costUsd: number }> = []
          for (const [date, v] of Object.entries(parsed)) {
            if (v.tokens > 0) {
              toImport.push({ date, tokens: v.tokens, costUsd: v.costUsd })
              if (!dailyUsage[date]) {
                dailyUsage[date] = { tokens: v.tokens, costUsd: v.costUsd }
              } else {
                dailyUsage[date]!.tokens += v.tokens
                dailyUsage[date]!.costUsd += v.costUsd
              }
            }
          }
          if (toImport.length > 0) {
            await window.agentkeeper.costs.addLegacy(toImport)
          }
          localStorage.removeItem('agentkeeper:dailyUsage')
        } catch { /* ignore corrupt legacy data */ }
      }
      localStorage.setItem('agentkeeper:legacyImported', '1')
    }
  }).catch(() => { /* non-fatal */ })

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
      roleId: plain.roleId ?? null,
      agencyInstanceId: null,
      agencyName: null,
      agencyId: null,
      agencyScope: null,
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
      draftMessage: '',
      draftAttachments: [],
    }
    void loadDraft(localId).then((d) => {
      const s = sessions[localId]
      if (!s) return
      if (d.text) s.draftMessage = d.text
      if (d.attachments.length > 0) s.draftAttachments = d.attachments
    })
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
    delete sessionTokens[id]
    delete sessionTurns[id]
    delete sessionRunTokens[id]
    delete sessionOutputEstimates[id]
    void window.agentkeeper.drafts.clear(id)
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
      roleId: null,
      agencyInstanceId: entry.agencyInstanceId ?? null,
      agencyName: entry.agencyName ?? null,
      agencyId: null,
      agencyScope: null,
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
      draftMessage: '',
      draftAttachments: [],
    }
    void loadDraft(entry.localId).then((d) => {
      const s = sessions[entry.localId]
      if (!s) return
      if (d.text) s.draftMessage = d.text
      if (d.attachments.length > 0) s.draftAttachments = d.attachments
    })
    flushBuffer(entry.localId)
  }

  function clearFocus(): void {
    currentLiveId.value = null
  }

  function openPersisted(persisted: Session): string {
    const localId = persisted.localId
    if (!sessions[localId]) {
      sessions[localId] = {
        ...persisted,
        events: [],
        error: null,
        agencyPrompt: null,
        resumedFromSdkSessionId: persisted.sdkSessionId,
        interruptedAt: null,
        isDraft: false,
        draftConfig: null,
        draftMessage: '',
        draftAttachments: [],
      }
      void loadDraft(localId).then((d) => {
        const s = sessions[localId]
        if (!s) return
        if (d.text) s.draftMessage = d.text
        if (d.attachments.length > 0) s.draftAttachments = d.attachments
      })
      flushBuffer(localId)
    }
    currentLiveId.value = localId
    return localId
  }

  function openHistorical(projectPath: string, summary: SessionSummary): string {
    // Reuse an existing in-memory entry for this SDK session rather than
    // creating a fresh localId every time — multiple clicks would otherwise
    // add duplicate cards to visibleSessions.
    const existing = Object.values(sessions).find(
      (s) => s.resumedFromSdkSessionId === summary.id,
    )
    if (existing) {
      currentLiveId.value = existing.localId
      return existing.localId
    }

    const localId = cryptoRandomId()
    sessions[localId] = {
      localId,
      sdkSessionId: null,
      projectPath,
      worktreePath: null,
      branch: summary.gitBranch,
      roleName: null,
      roleId: null,
      agencyInstanceId: null,
      agencyName: null,
      agencyId: null,
      agencyScope: null,
      initialPrompt: summary.firstUserMessage ?? '',
      agencyPrompt: null,
      title: null,
      model: summary.model,
      effort: null,
      permissionMode: null,
      status: 'idle',
      events: [],
      error: null,
      startedAt: summary.startedAt,
      lastActivityAt: summary.lastActivityAt,
      resumedFromSdkSessionId: summary.id,
      interruptedAt: null,
      workItemKey: null,
      workItemTitle: null,
      isDraft: false,
      draftConfig: null,
      draftMessage: '',
      draftAttachments: [],
    }
    currentLiveId.value = localId
    return localId
  }

  function openPersistedAgency(
    memberSessions: Session[],
  ): string {
    for (const s of memberSessions) {
      if (!sessions[s.localId]) {
        sessions[s.localId] = {
          ...s,
          events: [],
          error: null,
          agencyPrompt: null,
          resumedFromSdkSessionId: s.sdkSessionId,
          interruptedAt: null,
          isDraft: false,
          draftConfig: null,
          draftMessage: '',
          draftAttachments: [],
        }
        const sid = s.localId
        void loadDraft(sid).then((d) => {
          const sess = sessions[sid]
          if (!sess) return
          if (d.text) sess.draftMessage = d.text
          if (d.attachments.length > 0) sess.draftAttachments = d.attachments
        })
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
      roleId: null,
      agencyInstanceId: null,
      agencyName: null,
      agencyId: null,
      agencyScope: null,
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
      draftMessage: '',
      draftAttachments: [],
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
      roleId: null,
      agencyInstanceId: null,
      agencyName: null,
      agencyId: null,
      agencyScope: null,
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
      draftMessage: '',
      draftAttachments: [],
    }
    void loadDraft(localId).then((d) => {
      const s = sessions[localId]
      if (!s) return
      if (d.text) s.draftMessage = d.text
      if (d.attachments.length > 0) s.draftAttachments = d.attachments
    })
    currentLiveId.value = localId
    return localId
  }

  function setDraftMessage(localId: string, text: string, attachments: Attachment[] = []): void {
    const s = sessions[localId]
    if (!s) return
    s.draftMessage = text
    s.draftAttachments = attachments
    // Persist to SQLite — no size limit, no silent truncation of attachments.
    void window.agentkeeper.drafts.set(localId, text, attachments)
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
    attachments?: Attachment[],
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
      ...(attachments && attachments.length > 0 ? { initialAttachments: attachments } : {}),
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

  // Tracks the index in session.events of the current partial assistant event
  // being built from stream_event deltas, keyed by sessionId.
  const streamingPartials: Record<string, number> = {}

  window.agentkeeper.sessions.onEvent((payload) => {
    const raw = payload.message as Record<string, unknown>

    // ── Streaming partial path ──────────────────────────────────────────────
    if (raw['type'] === 'stream_event') {
      const s = sessions[payload.sessionId]
      if (!s) return  // drop stream events for unregistered sessions; AssistantMessage will buffer

      const event = raw['event'] as Record<string, unknown> | undefined
      if (!event) return

      switch (event['type']) {
        case 'message_start': {
          // Begin a new partial assistant event and track its index
          const partial: TranscriptEvent = {
            uuid: typeof raw['uuid'] === 'string' ? raw['uuid'] : crypto.randomUUID(),
            parentUuid: null,
            timestamp: new Date().toISOString(),
            kind: 'assistant',
            role: 'assistant',
            isMeta: false,
            isSidechain: typeof raw['parent_tool_use_id'] === 'string',
            model: (() => {
              const msg = event['message'] as Record<string, unknown> | undefined
              return typeof msg?.['model'] === 'string' ? msg['model'] : null
            })(),
            content: [],
            parentToolUseId: typeof raw['parent_tool_use_id'] === 'string'
              ? raw['parent_tool_use_id']
              : null,
            systemSubtype: null,
          }
          s.events.push(partial)
          streamingPartials[payload.sessionId] = s.events.length - 1
          s.lastActivityAt = Date.now()

          // input_tokens are known at message_start — add them immediately so
          // the counter starts moving as soon as a new API call begins.
          const startMsg = event['message'] as Record<string, unknown> | undefined
          const startUsage = startMsg?.['usage'] as Record<string, unknown> | undefined
          const inputTokens = (startUsage?.['input_tokens'] as number | undefined) ?? 0
          if (inputTokens > 0) {
            sessionRunTokens[payload.sessionId] =
              (sessionRunTokens[payload.sessionId] ?? 0) + inputTokens
            void window.agentkeeper.stats.upsert(
              payload.sessionId,
              sessionTokens[payload.sessionId]?.tokens ?? 0,
              sessionTokens[payload.sessionId]?.costUsd ?? 0,
              sessionTurns[payload.sessionId] ?? 0,
              sessionRunTokens[payload.sessionId]!,
            )
          }
          // Reset the streaming estimate — a new response is beginning.
          sessionOutputEstimates[payload.sessionId] = 0
          break
        }
        case 'message_delta': {
          // output_tokens are finalised at message_delta (end of each streaming response).
          // Add actual count to sessionRunTokens and zero the estimate — it's now
          // captured precisely rather than via the char-based approximation.
          const deltaUsage = event['usage'] as Record<string, unknown> | undefined
          const outputTokens = (deltaUsage?.['output_tokens'] as number | undefined) ?? 0
          if (outputTokens > 0) {
            sessionRunTokens[payload.sessionId] =
              (sessionRunTokens[payload.sessionId] ?? 0) + outputTokens
          }
          void window.agentkeeper.stats.upsert(
            payload.sessionId,
            sessionTokens[payload.sessionId]?.tokens ?? 0,
            sessionTokens[payload.sessionId]?.costUsd ?? 0,
            sessionTurns[payload.sessionId] ?? 0,
            sessionRunTokens[payload.sessionId] ?? 0,
          )
          sessionOutputEstimates[payload.sessionId] = 0
          break
        }
        case 'content_block_start': {
          const idx = streamingPartials[payload.sessionId]
          if (idx === undefined) break
          const partial = s.events[idx]
          if (!partial) break
          const cb = event['content_block'] as Record<string, unknown> | undefined
          if (cb?.['type'] === 'text') {
            partial.content.push({ type: 'text', text: '' })
          }
          // tool_use blocks: skip — the complete AssistantMessage will carry them
          break
        }
        case 'content_block_delta': {
          const idx = streamingPartials[payload.sessionId]
          if (idx === undefined) break
          const partial = s.events[idx]
          if (!partial) break
          const delta = event['delta'] as Record<string, unknown> | undefined
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            // Append to the last text block
            for (let i = partial.content.length - 1; i >= 0; i--) {
              const blk = partial.content[i]
              if (blk && blk.type === 'text') {
                blk.text += delta['text']
                break
              }
            }
            s.lastActivityAt = Date.now()

            // Accumulate a real-time output token estimate (~4 chars per token).
            // This gives a smoothly incrementing counter during streaming;
            // message_delta replaces it with the authoritative count.
            sessionOutputEstimates[payload.sessionId] =
              (sessionOutputEstimates[payload.sessionId] ?? 0) +
              Math.ceil(delta['text'].length / 4)
          }
          break
        }
      }
      return
    }

    // ── Complete message path ───────────────────────────────────────────────
    const evt = sdkMessageToTranscriptEvent(payload.message)
    if (!evt) return

    const s = sessions[payload.sessionId]
    if (s) {
      // If a partial assistant event was being streamed, replace it with the
      // definitive complete message rather than appending a duplicate.
      const partialIdx = streamingPartials[payload.sessionId]
      if (partialIdx !== undefined && evt.role === 'assistant') {
        s.events.splice(partialIdx, 1, evt)
        delete streamingPartials[payload.sessionId]
      } else {
        s.events.push(evt)
      }
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
    const tokens = u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
    const costUsd = u.totalCostUsd
    if (tokens > 0 || costUsd > 0) {
      const key = localDateKey()
      if (!dailyUsage[key]) dailyUsage[key] = { tokens: 0, costUsd: 0 }
      dailyUsage[key]!.tokens += tokens
      dailyUsage[key]!.costUsd += costUsd

      // Bucket per-session so the agent tree can display per-agent token counts.
      if (!sessionTokens[u.sessionId]) {
        sessionTokens[u.sessionId] = { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
      }
      sessionTokens[u.sessionId]!.tokens += tokens
      sessionTokens[u.sessionId]!.costUsd += costUsd
      sessionTokens[u.sessionId]!.inputTokens += u.inputTokens
      sessionTokens[u.sessionId]!.outputTokens += u.outputTokens
      sessionTokens[u.sessionId]!.cacheReadTokens += u.cacheReadInputTokens
      sessionTokens[u.sessionId]!.cacheCreationTokens += u.cacheCreationInputTokens
      sessionTokens[u.sessionId]!.inputCostUsd += u.inputCostUsd
      sessionTokens[u.sessionId]!.outputCostUsd += u.outputCostUsd
      sessionTokens[u.sessionId]!.cacheReadCostUsd += u.cacheReadCostUsd
      sessionTokens[u.sessionId]!.cacheCreationCostUsd += u.cacheCreationCostUsd

      // Each onStats call represents one completed assistant turn.
      sessionTurns[u.sessionId] = (sessionTurns[u.sessionId] ?? 0) + 1

      // Run is complete — clear in-progress counters so the display doesn't
      // double-count (sessionTokens now covers everything they tracked).
      sessionRunTokens[u.sessionId] = 0
      sessionOutputEstimates[u.sessionId] = 0
      void window.agentkeeper.stats.upsert(
        u.sessionId,
        sessionTokens[u.sessionId]!.tokens,
        sessionTokens[u.sessionId]!.costUsd,
        sessionTurns[u.sessionId] ?? 0,
        0, // in-progress reset to 0 on turn completion
      )
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

      // Rescue any in-progress tokens that onStats didn't capture (e.g. the run
      // threw before emitting a result message). In the normal path onStats fires
      // first and resets sessionRunTokens to 0, so this is a no-op. Only the
      // error/interrupt/terminated path ever finds a non-zero value here.
      const quiescent =
        update.status === 'idle' ||
        update.status === 'completed' ||
        update.status === 'terminated' ||
        update.status === 'error'
      const partial = quiescent ? (sessionRunTokens[update.sessionId] ?? 0) : 0
      if (partial > 0) {
        if (!sessionTokens[update.sessionId]) {
          sessionTokens[update.sessionId] = { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
        }
        sessionTokens[update.sessionId]!.tokens += partial
        sessionRunTokens[update.sessionId] = 0
        sessionOutputEstimates[update.sessionId] = 0
        void window.agentkeeper.stats.upsert(
          update.sessionId,
          sessionTokens[update.sessionId]!.tokens,
          sessionTokens[update.sessionId]!.costUsd ?? 0,
          sessionTurns[update.sessionId] ?? 0,
          0,
        )
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
    sessionTokens,
    sessionTurns,
    sessionRunTokens,
    sessionOutputEstimates,
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
    openHistorical,
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
