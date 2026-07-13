import { defineStore } from 'pinia'
import { computed, onScopeDispose, reactive, ref, toRaw, watch } from 'vue'
import { toast } from 'vue-sonner'
import router from '../router'
import type {
  Agency,
  Agent,
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
import { isGeneralProject } from '@shared/ipc-contract'
import { sdkMessageToTranscriptEvent } from '@/lib/sdk-normalize'
import { playNotificationSound } from '@/lib/notificationSound'
import { queryClient } from '@/lib/queryClient'
import { queryKeys } from '@/lib/queryKeys'

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
  /** IDs of McpServerEntry items from AppSettings.mcpServers to activate. */
  mcpServerIds: string[]
}

export interface LiveSession extends Session {
  // Runtime-only — not persisted, not IPC-transferable
  /** All events in chronological order — used by MonitorView and ContextPanel. */
  events: TranscriptEvent[]
  /** Per-agent event streams. Key = agentLocalId. */
  agentEvents: Record<string, TranscriptEvent[]>
  /** Agents running within this session. */
  agents: Agent[]
  error: string | null
  agencyPrompt: string | null
  interruptedAt: number | null
  currentTurnStartedAt: number | null
  currentTurnEndedAt: number | null
  isDraft: boolean
  draftConfig: DraftSessionConfig | null
  draftMessage: string
  draftAttachments: Attachment[]
}

function computeSessionStatus(agentList: Agent[]): LiveSessionStatus {
  if (agentList.length === 0) return 'idle'
  if (agentList.some(a => a.status === 'running' || a.status === 'starting')) return 'running'
  if (agentList.some(a => a.status === 'blocked')) return 'blocked'
  if (agentList.every(a => a.status === 'completed')) return 'completed'
  if (agentList.every(a => a.status === 'inactive')) return 'inactive'
  if (agentList.some(a => a.status === 'error')) return 'error'
  return 'idle'
}

function plainParams(p: StartSessionParams): StartSessionParams {
  // JSON round-trip strips Vue reactive Proxies at any depth (e.g. an array
  // accessed through a role proxy).
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

interface DayUsage {
  tokens: number
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

interface TokenStats {
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
}

async function triggerSessionNotification(sessionLocalId: string, title: string) {
  const settings = await window.agentkeeper.settings.get()
  const pref = settings.notifications ?? 'all'
  if (pref === 'disabled') return

  if (pref === 'sound-only' || pref === 'all') {
    playNotificationSound(settings.notificationSound ?? 'chime')
  }

  if (pref === 'toast') {
    toast('Session ready', {
      description: title,
      action: {
        label: 'Open',
        onClick: () => { void router.push(`/sessions/${sessionLocalId}`) },
      },
      duration: 8000,
    })
    return
  }

  if (pref === 'all' || pref === 'notification-only') {
    const silent = pref === 'all'
    await window.agentkeeper.notifications?.trigger(sessionLocalId, title, silent)
  }
}

export const useSessionStore = defineStore('sessions', () => {

  function localDateKey(date = new Date()): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const dailyUsage = reactive<Record<string, DayUsage>>({})

  // Daily usage split by project path → same DayUsage keyed by date.
  const dailyUsageByProject = reactive<Record<string, Record<string, DayUsage>>>({})

  // Per-session token/cost accumulator — keyed by sessionLocalId.
  const sessionTokens = reactive<Record<string, TokenStats>>({})

  // Per-agent token/cost accumulator — keyed by agentLocalId.
  const agentTokens = reactive<Record<string, TokenStats>>({})

  // Per-session assistant-turn counter — incremented on each onStats (one per turn).
  const sessionTurns = reactive<Record<string, number>>({})

  // In-progress token count for the currently executing SDK run — keyed by agentLocalId.
  const sessionRunTokens = reactive<Record<string, number>>({})

  // Real-time output token estimate built from content_block_delta text chunks.
  const sessionOutputEstimates = reactive<Record<string, number>>({})

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
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith('agentkeeper:stok:') || key.startsWith('agentkeeper:sturn:') || key.startsWith('agentkeeper:srun:')) {
            localStorage.removeItem(key)
          }
        }
        localStorage.setItem('agentkeeper:statsImported', '1')
      }

      const rows = await queryClient.fetchQuery({
        queryKey: queryKeys.stats.all(),
        queryFn: () => window.agentkeeper.stats.getAll(),
        staleTime: 60_000,
      })
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

  // Authoritative counts pushed from main at the end of each query turn.
  const activeAgentCount = ref(0)
  const runningSessionCount = ref(0)

  void queryClient.fetchQuery({
    queryKey: queryKeys.costs.daily(),
    queryFn: () => window.agentkeeper.costs.getDailySummary(),
    staleTime: 60_000,
  }).then(async (rows) => {
    for (const row of rows) {
      dailyUsage[row.date] = { tokens: row.tokens, costUsd: row.costUsd, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, cacheCreationTokens: row.cacheCreationTokens }
    }

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
                dailyUsage[date] = { tokens: v.tokens, costUsd: v.costUsd, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
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

  void queryClient.fetchQuery({
    queryKey: queryKeys.costs.dailyByProject(),
    queryFn: () => window.agentkeeper.costs.getDailySummaryByProject(),
    staleTime: 60_000,
  }).then((rows) => {
    for (const row of rows) {
      const map = dailyUsageByProject[row.projectPath] ?? (dailyUsageByProject[row.projectPath] = {})
      map[row.date] = { tokens: row.tokens, costUsd: row.costUsd, inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheReadTokens: row.cacheReadTokens, cacheCreationTokens: row.cacheCreationTokens }
    }
  }).catch(() => { /* non-fatal */ })

  // reactive() dict so sub-property mutations trigger updates
  const sessions = reactive<Record<string, LiveSession>>({})
  const currentLiveId = ref<string | null>(null)

  // Buffer for status/event payloads that arrive before the session is
  // registered in the store.
  const buffered = reactive<
    Record<
      string,
      {
        events: Array<{ agentLocalId: string | null; event: TranscriptEvent }>
        status: LiveSessionStatus | null
        sdkSessionId: string | null
        agentLocalId: string | null
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
        agentLocalId: null,
        error: null,
      }
    }
    return buffered[id]!
  }

  function flushBuffer(id: string) {
    const buf = buffered[id]
    const s = sessions[id]
    if (!buf || !s) return
    for (const { agentLocalId, event } of buf.events) {
      s.events.push(event)
      const aId = agentLocalId ?? id
      if (!s.agentEvents[aId]) s.agentEvents[aId] = []
      s.agentEvents[aId]!.push(event)
    }
    if (buf.status) s.status = buf.status
    if (buf.sdkSessionId && buf.agentLocalId) {
      const agent = s.agents.find(a => a.localId === buf.agentLocalId)
      if (agent) agent.sdkSessionId = buf.sdkSessionId!
    }
    if (buf.error) s.error = buf.error
    delete buffered[id]
  }

  const liveList = computed(() =>
    Object.values(sessions).sort(
      (a, b) => (b.lastUserMessageAt ?? b.startedAt) - (a.lastUserMessageAt ?? a.startedAt),
    ),
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
    const now = Date.now()

    sessions[localId] = {
      localId,
      projectPath: plain.projectPath,
      worktreePath: plain.worktreePath ?? null,
      branch: plain.branch ?? null,
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
      agentEvents: { [localId]: [] },
      agents: [{
        localId,
        sessionLocalId: localId,
        sdkSessionId: null,
        roleId: plain.roleId ?? null,
        roleName: (plain as { roleName?: string | null }).roleName ?? null,
        roleInstanceIndex: plain.roleInstanceIndex ?? null,
        initialPrompt: plain.initialPrompt,
        isEntryPoint: true,
        status: 'starting',
        startedAt: now,
        lastActivityAt: now,
      }],
      error: null,
      startedAt: now,
      lastActivityAt: now,
      lastUserMessageAt: null,
      interruptedAt: null,
      currentTurnStartedAt: null,
      currentTurnEndedAt: null,
      workItemKey: plain.workItemKey ?? null,
      workItemTitle: plain.workItemTitle ?? null,
      planState: null,
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
    flushBuffer(localId)

    try {
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
      s.lastUserMessageAt = Date.now()
    } catch (err) {
      s.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function interrupt(id: string): Promise<void> {
    const s = sessions[id]
    if (!s) return
    try {
      const didInterrupt = await window.agentkeeper.sessions.interrupt(id)
      if (didInterrupt) {
        s.interruptedAt = Date.now()
        const entry: TranscriptEvent = {
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
        }
        s.events.push(entry)
        const entryAgent = s.agents.find(a => a.isEntryPoint) ?? s.agents[0]
        if (entryAgent) {
          if (!s.agentEvents[entryAgent.localId]) s.agentEvents[entryAgent.localId] = []
          s.agentEvents[entryAgent.localId]!.push(entry)
        }
      }
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
    const s = sessions[id]
    if (s) {
      for (const agent of s.agents) {
        delete agentTokens[agent.localId]
        delete sessionRunTokens[agent.localId]
        delete sessionOutputEstimates[agent.localId]
      }
    }
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
   * Register an agent started outside the store (e.g. by the orchestrator
   * as part of an agency). Creates the session entry on first call; subsequent
   * calls for the same session just add agents.
   */
  function registerExternal(entry: {
    localId: string
    sessionLocalId: string
    projectPath: string | null
    worktreePath?: string | null
    branch?: string | null
    roleName?: string | null
    agencyName?: string | null
    agencyId?: string | null
    agencyScope?: string | null
    initialPrompt: string
    agencyPrompt?: string | null
    model?: string | null
    effort?: RoleEffort | null
    permissionMode?: PermissionMode | null
    workItemKey?: string | null
    workItemTitle?: string | null
    isEntryPoint?: boolean
    roleId?: string | null
    roleInstanceIndex?: number | null
  }): void {
    const now = Date.now()
    // Create the session entry if this is the first agent for this session.
    if (!sessions[entry.sessionLocalId]) {
      sessions[entry.sessionLocalId] = {
        localId: entry.sessionLocalId,
        projectPath: entry.projectPath,
        worktreePath: entry.worktreePath ?? null,
        branch: entry.branch ?? null,
        agencyName: entry.agencyName ?? null,
        agencyId: entry.agencyId ?? null,
        agencyScope: (entry.agencyScope as LiveSession['agencyScope']) ?? null,
        initialPrompt: entry.agencyPrompt ?? entry.initialPrompt,
        agencyPrompt: entry.agencyPrompt ?? null,
        title: null,
        model: entry.model ?? null,
        effort: entry.effort ?? null,
        permissionMode: entry.permissionMode ?? null,
        status: 'starting',
        events: [],
        agentEvents: {},
        agents: [],
        error: null,
        startedAt: now,
        lastActivityAt: now,
        lastUserMessageAt: null,
        interruptedAt: null,
        currentTurnStartedAt: null,
        currentTurnEndedAt: null,
        workItemKey: entry.workItemKey ?? null,
        workItemTitle: entry.workItemTitle ?? null,
        planState: null,
        isDraft: false,
        draftConfig: null,
        draftMessage: '',
        draftAttachments: [],
      }
      void loadDraft(entry.sessionLocalId).then((d) => {
        const s = sessions[entry.sessionLocalId]
        if (!s) return
        if (d.text) s.draftMessage = d.text
        if (d.attachments.length > 0) s.draftAttachments = d.attachments
      })
      flushBuffer(entry.sessionLocalId)
    }

    const s = sessions[entry.sessionLocalId]!
    if (!s.agents.find(a => a.localId === entry.localId)) {
      s.agents.push({
        localId: entry.localId,
        sessionLocalId: entry.sessionLocalId,
        sdkSessionId: null,
        roleId: entry.roleId ?? null,
        roleName: entry.roleName ?? null,
        roleInstanceIndex: entry.roleInstanceIndex ?? null,
        initialPrompt: entry.initialPrompt,
        isEntryPoint: entry.isEntryPoint ?? false,
        status: 'starting',
        startedAt: now,
        lastActivityAt: now,
      })
    }
    if (!s.agentEvents[entry.localId]) s.agentEvents[entry.localId] = []
  }

  function clearFocus(): void {
    currentLiveId.value = null
  }

  // Populate agentEvents from the JSONL file written by the SDK for a given agent run.
  // No-ops if events are already present (live streaming beat us to it).
  async function loadAgentTranscriptFromDisk(
    sessionLocalId: string,
    agentLocalId: string,
    projectPath: string | null,
    sdkSessionId: string,
  ): Promise<void> {
    const s = sessions[sessionLocalId]
    if (!s) return
    if ((s.agentEvents[agentLocalId]?.length ?? 0) > 0) return
    try {
      const transcript = await window.agentkeeper.sessions.read(projectPath, sdkSessionId, s.harnessId)
      if (!transcript?.events.length) return
      // Re-check after async gap — live streaming may have populated by now.
      const s2 = sessions[sessionLocalId]
      if (!s2 || (s2.agentEvents[agentLocalId]?.length ?? 0) > 0) return
      if (!s2.agentEvents[agentLocalId]) s2.agentEvents[agentLocalId] = []
      s2.agentEvents[agentLocalId].push(...transcript.events)
      s2.events.push(...transcript.events)
    } catch {
      // Non-fatal — JSONL may not exist for a session that never ran.
    }
  }

  function openPersisted(persisted: Session): string {
    const localId = persisted.localId
    if (!sessions[localId]) {
      sessions[localId] = {
        ...persisted,
        events: [],
        agentEvents: {},
        agents: [],
        error: null,
        agencyPrompt: null,
        interruptedAt: null,
        currentTurnStartedAt: null,
        currentTurnEndedAt: null,
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
      void window.agentkeeper.sessions.getAgents(localId).then((agentList) => {
        const s = sessions[localId]
        if (!s) return
        s.agents = agentList
        for (const a of agentList) {
          if (!s.agentEvents[a.localId]) s.agentEvents[a.localId] = []
          if (a.sdkSessionId) {
            void loadAgentTranscriptFromDisk(localId, a.localId, s.projectPath, a.sdkSessionId)
          }
        }
      })
    }
    currentLiveId.value = localId
    return localId
  }

  function trackRunning(persisted: Session): void {
    const localId = persisted.localId
    if (sessions[localId]) return
    sessions[localId] = {
      ...persisted,
      events: [],
      agentEvents: {},
      agents: [],
      error: null,
      agencyPrompt: null,
      interruptedAt: null,
      currentTurnStartedAt: null,
      currentTurnEndedAt: null,
      isDraft: false,
      draftConfig: null,
      draftMessage: '',
      draftAttachments: [],
    }
    flushBuffer(localId)
    void window.agentkeeper.sessions.getAgents(localId).then((agentList) => {
      const s = sessions[localId]
      if (!s) return
      s.agents = agentList
      for (const a of agentList) {
        if (!s.agentEvents[a.localId]) s.agentEvents[a.localId] = []
        if (a.sdkSessionId) {
          void loadAgentTranscriptFromDisk(localId, a.localId, s.projectPath, a.sdkSessionId)
        }
      }
    })
  }

  function openHistorical(projectPath: string | null, summary: SessionSummary): string {
    const existing = Object.values(sessions).find(
      (s) => s.agents.some((a) => a.sdkSessionId === summary.id),
    )
    if (existing) {
      currentLiveId.value = existing.localId
      return existing.localId
    }

    const localId = cryptoRandomId()
    sessions[localId] = {
      localId,
      projectPath,
      worktreePath: null,
      branch: summary.gitBranch,
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
      agentEvents: { [localId]: [] },
      agents: [{
        localId,
        sessionLocalId: localId,
        sdkSessionId: summary.id,
        roleId: null,
        roleName: null,
        roleInstanceIndex: null,
        initialPrompt: summary.firstUserMessage ?? '',
        isEntryPoint: true,
        status: 'idle',
        startedAt: summary.startedAt,
        lastActivityAt: summary.lastActivityAt,
      }],
      error: null,
      startedAt: summary.startedAt,
      lastActivityAt: summary.lastActivityAt,
      lastUserMessageAt: null,
      interruptedAt: null,
      currentTurnStartedAt: null,
      currentTurnEndedAt: null,
      workItemKey: null,
      workItemTitle: null,
      planState: null,
      isDraft: false,
      draftConfig: null,
      draftMessage: '',
      draftAttachments: [],
    }
    void loadAgentTranscriptFromDisk(localId, localId, projectPath, summary.id)
    currentLiveId.value = localId
    return localId
  }

  /** Compatibility shim — after migration there is one session row per agency, not N members. */
  function openPersistedAgency(memberSessions: Session[]): string {
    const session = memberSessions[0]
    if (!session) return ''
    return openPersisted(session)
  }

  async function resumeFromHistory(params: {
    sdkSessionId: string
    projectPath: string | null
    firstMessage: string
    model: string
    effort: RoleEffort
  }): Promise<string> {
    const localId = cryptoRandomId()
    const now = Date.now()
    sessions[localId] = {
      localId,
      projectPath: params.projectPath,
      worktreePath: null,
      branch: null,
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
      agentEvents: { [localId]: [] },
      agents: [{
        localId,
        sessionLocalId: localId,
        sdkSessionId: params.sdkSessionId,
        roleId: null,
        roleName: null,
        roleInstanceIndex: null,
        initialPrompt: params.firstMessage || '(continued)',
        isEntryPoint: true,
        status: 'idle',
        startedAt: now,
        lastActivityAt: now,
      }],
      error: null,
      startedAt: now,
      lastActivityAt: now,
      lastUserMessageAt: null,
      interruptedAt: null,
      currentTurnStartedAt: null,
      currentTurnEndedAt: null,
      workItemKey: null,
      workItemTitle: null,
      planState: null,
      isDraft: false,
      draftConfig: null,
      draftMessage: '',
      draftAttachments: [],
    }
    // Load the prior run's transcript before the new SDK run starts streaming.
    await loadAgentTranscriptFromDisk(localId, localId, params.projectPath, params.sdkSessionId)
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

  function createOrFocusDraft(params: {
    projectPath: string | null
    defaultModel: string
    defaultEffort: RoleEffort
    defaultUseWorktree: boolean
    defaultMcpServerIds?: string[]
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
      projectPath: params.projectPath,
      worktreePath: null,
      branch: null,
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
      agentEvents: {},
      agents: [],
      error: null,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      lastUserMessageAt: null,
      interruptedAt: null,
      currentTurnStartedAt: null,
      currentTurnEndedAt: null,
      workItemKey: null,
      workItemTitle: null,
      planState: null,
      isDraft: true,
      draftConfig: {
        agencyKey: '',
        roleId: '',
        useWorktree: params.defaultUseWorktree,
        branch: '',
        branchTouched: false,
        effortTouched: false,
        mcpServerIds: params.defaultMcpServerIds ?? [],
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

  /** Re-point a draft at a different project context. Context is a per-session
   *  choice now, so retargeting a not-yet-started draft mutates it in place
   *  rather than spawning a new one. Worktree branch resets since it was scoped
   *  to the old project. */
  function retargetDraft(localId: string, projectPath: string | null): void {
    const s = sessions[localId]
    if (!s || !s.isDraft) return
    s.projectPath = projectPath
    if (s.draftConfig) {
      s.draftConfig.branch = ''
      s.draftConfig.branchTouched = false
      if (isGeneralProject(projectPath)) s.draftConfig.useWorktree = false
    }
  }

  function setDraftMessage(localId: string, text: string, attachments: Attachment[] = []): void {
    const s = sessions[localId]
    if (!s) return
    s.draftMessage = text
    s.draftAttachments = attachments
    void window.agentkeeper.drafts.set(localId, text, attachments)
  }

  /**
   * Promote a draft into a live session by sending its first message.
   * For agency drafts: dismisses the draft and registers the agency session.
   * For plain drafts: updates the same entry in-place and starts the SDK session.
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
        ...(attachments && attachments.length > 0 ? { initialAttachments: attachments } : {}),
        useWorktree: cfg.useWorktree && !isGeneralProject(projectPath),
        ...(cfg.useWorktree && cfg.branch.trim() && !isGeneralProject(projectPath) ? { branch: cfg.branch.trim() } : {}),
        ...(draft.model ? { model: draft.model } : {}),
      })
      delete sessions[localId]
      for (const s of instance.sessions) {
        const role = ctx.roles.find((r) => r.id === s.roleId) ?? null
        registerExternal({
          localId: s.localId,
          sessionLocalId: s.sessionLocalId,
          projectPath: instance.projectPath,
          worktreePath: instance.worktreePath,
          branch: instance.branch,
          roleName: s.roleName,
          roleId: s.roleId,
          agencyName: instance.agencyName,
          initialPrompt: s.isEntryPoint ? trimmedPrompt : '(awaiting peers)',
          agencyPrompt: trimmedPrompt,
          model: role?.model ?? draft.model,
          isEntryPoint: s.isEntryPoint,
        })
      }
      // Sync agent statuses from DB — broadcasts may arrive before registerExternal runs
      void window.agentkeeper.sessions.getAgents(instance.instanceId).then((agentList) => {
        const s = sessions[instance.instanceId]
        if (!s) return
        for (const db of agentList) {
          const mem = s.agents.find(a => a.localId === db.localId)
          if (!mem) continue
          if (mem.status === 'starting' && db.status !== 'starting') {
            mem.status = db.status
          }
          if (db.sdkSessionId && !mem.sdkSessionId) mem.sdkSessionId = db.sdkSessionId
        }
        const rollup = computeSessionStatus(s.agents)
        if (s.status !== rollup) s.status = rollup
      })
      // Focus the session UUID (not an individual agent UUID)
      currentLiveId.value = instance.instanceId
      return instance.instanceId
    }

    let worktreePath: string | undefined
    let branch: string | undefined
    // General chats have no project — never spin up a worktree for them.
    if (cfg.useWorktree && cfg.branch.trim() && !isGeneralProject(projectPath)) {
      const wt = await window.agentkeeper.worktrees.create(projectPath, cfg.branch.trim())
      worktreePath = wt.path
      branch = wt.branch
    }

    const role = cfg.roleId ? (ctx.roles.find((r) => r.id === cfg.roleId) ?? null) : null

    draft.isDraft = false
    draft.draftConfig = null
    draft.worktreePath = worktreePath ?? null
    draft.branch = branch ?? null
    draft.initialPrompt = trimmedPrompt
    draft.status = 'starting'
    const now = Date.now()
    draft.lastActivityAt = now
    // Ensure the solo agent entry exists (draft sessions start with agents: []).
    let soloAgent = draft.agents[0]
    if (!soloAgent) {
      soloAgent = {
        localId,
        sessionLocalId: localId,
        sdkSessionId: null,
        roleId: role?.id ?? null,
        roleName: role?.name ?? null,
        roleInstanceIndex: null,
        initialPrompt: trimmedPrompt,
        isEntryPoint: true,
        status: 'starting',
        startedAt: now,
        lastActivityAt: now,
      }
      draft.agents.push(soloAgent)
      if (!draft.agentEvents[localId]) draft.agentEvents[localId] = []
    } else {
      soloAgent.initialPrompt = trimmedPrompt
      if (role) {
        soloAgent.roleId = role.id
        soloAgent.roleName = role.name
      }
    }

    const startArgs: StartSessionParams = {
      localId,
      projectPath,
      ...(worktreePath ? { worktreePath } : {}),
      ...(role?.systemPrompt ? { systemPromptAppend: role.systemPrompt } : {}),
      initialPrompt: trimmedPrompt,
      ...(draft.model ? { model: draft.model } : {}),
      ...(draft.effort ? { effort: draft.effort } : {}),
      ...(draft.permissionMode ? { permissionMode: draft.permissionMode } : {}),
      ...(role?.name ? { roleName: role.name } : {}),
      ...(attachments && attachments.length > 0 ? { initialAttachments: attachments } : {}),
      ...(cfg.mcpServerIds.length > 0 ? { mcpServerIds: cfg.mcpServerIds } : {}),
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

  const visibleSessions = computed<LiveSession[]>(() =>
    Object.values(sessions)
      .filter(s => !s.isDraft)
      .sort((a, b) => (b.lastUserMessageAt ?? b.startedAt) - (a.lastUserMessageAt ?? a.startedAt)),
  )

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
    return session.agents.length || 1
  }

  function buildTokenStats(usage: Record<string, DayUsage>) {
    const todayKey = localDateKey()
    const today = usage[todayKey] ?? { tokens: 0, costUsd: 0 }
    const now = new Date()
    const history: Array<{ date: string; tokens: number; costUsd: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const key = localDateKey(d)
      const day = usage[key]
      history.push({
        date: key,
        tokens: day?.tokens ?? 0,
        costUsd: day?.costUsd ?? 0,
        inputTokens: day?.inputTokens ?? 0,
        outputTokens: day?.outputTokens ?? 0,
        cacheReadTokens: day?.cacheReadTokens ?? 0,
        cacheCreationTokens: day?.cacheCreationTokens ?? 0,
      })
    }
    return {
      tokensToday: today.tokens,
      costUsdToday: today.costUsd,
      dailyHistory: history,
    }
  }

  const tokenStats = computed(() => buildTokenStats(dailyUsage))

  // Same shape as `tokenStats` but scoped to a single project; `null` returns
  // the global roll-up. Persisted history comes from the per-project cost
  // summary; live turns are attributed in the onStats handler below.
  function tokenStatsFor(projectPath: string | null) {
    if (!projectPath) return buildTokenStats(dailyUsage)
    return buildTokenStats(dailyUsageByProject[projectPath] ?? {})
  }

  // ─── IPC subscriptions — set up once ───────────────────────────────────

  // Tracks the index of the current partial assistant event per agentLocalId.
  const streamingPartials: Record<string, number> = {}

  window.agentkeeper.sessions.onEvent((payload) => {
    const raw = payload.message as Record<string, unknown>
    // agentLocalId in event; fall back to sessionId for solo sessions
    const agentKey = payload.agentLocalId ?? payload.sessionId
    const sessionId = payload.sessionId

    // ── Streaming partial path ──────────────────────────────────────────────
    if (raw['type'] === 'stream_event') {
      const s = sessions[sessionId]
      if (!s) return

      if (!s.agentEvents[agentKey]) s.agentEvents[agentKey] = []
      const agentEvts = s.agentEvents[agentKey]!

      const event = raw['event'] as Record<string, unknown> | undefined
      if (!event) return

      switch (event['type']) {
        case 'message_start': {
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
          agentEvts.push(partial)
          s.events.push(partial)
          streamingPartials[agentKey] = agentEvts.length - 1
          s.lastActivityAt = Date.now()

          const startMsg = event['message'] as Record<string, unknown> | undefined
          const startUsage = startMsg?.['usage'] as Record<string, unknown> | undefined
          const inputTokens = (startUsage?.['input_tokens'] as number | undefined) ?? 0
          if (inputTokens > 0) {
            sessionRunTokens[agentKey] = (sessionRunTokens[agentKey] ?? 0) + inputTokens
            void window.agentkeeper.stats.upsert(
              sessionId,
              sessionTokens[sessionId]?.tokens ?? 0,
              sessionTokens[sessionId]?.costUsd ?? 0,
              sessionTurns[sessionId] ?? 0,
              sessionRunTokens[agentKey]!,
            )
          }
          sessionOutputEstimates[agentKey] = 0
          break
        }
        case 'message_delta': {
          const deltaUsage = event['usage'] as Record<string, unknown> | undefined
          const outputTokens = (deltaUsage?.['output_tokens'] as number | undefined) ?? 0
          if (outputTokens > 0) {
            sessionRunTokens[agentKey] = (sessionRunTokens[agentKey] ?? 0) + outputTokens
          }
          void window.agentkeeper.stats.upsert(
            sessionId,
            sessionTokens[sessionId]?.tokens ?? 0,
            sessionTokens[sessionId]?.costUsd ?? 0,
            sessionTurns[sessionId] ?? 0,
            sessionRunTokens[agentKey] ?? 0,
          )
          sessionOutputEstimates[agentKey] = 0
          break
        }
        case 'content_block_start': {
          const idx = streamingPartials[agentKey]
          if (idx === undefined) break
          const partial = agentEvts[idx]
          if (!partial) break
          const cb = event['content_block'] as Record<string, unknown> | undefined
          if (cb?.['type'] === 'text') {
            partial.content.push({ type: 'text', text: '' })
          }
          break
        }
        case 'content_block_delta': {
          const idx = streamingPartials[agentKey]
          if (idx === undefined) break
          const partial = agentEvts[idx]
          if (!partial) break
          const delta = event['delta'] as Record<string, unknown> | undefined
          if (delta?.['type'] === 'text_delta' && typeof delta['text'] === 'string') {
            for (let i = partial.content.length - 1; i >= 0; i--) {
              const blk = partial.content[i]
              if (blk && blk.type === 'text') {
                blk.text += delta['text']
                break
              }
            }
            s.lastActivityAt = Date.now()
            sessionOutputEstimates[agentKey] =
              (sessionOutputEstimates[agentKey] ?? 0) +
              Math.ceil(delta['text'].length / 4)
          }
          break
        }
      }
      return
    }

    // ── Complete message path ───────────────────────────────────────────────
    let evt = sdkMessageToTranscriptEvent(payload.message)
    if (!evt) return

    // Reclassify non-human user messages so they don't render as "you" bubbles.
    // Two cases:
    //   1. Sidechain messages (parent_tool_use_id set) are sub-agent prompts spawned
    //      by the Agent tool — always reclassify, regardless of entry-point status.
    //   2. First user message of a non-entry-point agent.
    if (
      evt.kind === 'user' &&
      evt.role === 'user' &&
      evt.content.length > 0 &&
      !evt.content.every((b) => b.type === 'tool_result')
    ) {
      const s = sessions[sessionId]
      const agent = s?.agents.find((a) => a.localId === agentKey)

      let shouldReclassify = false
      if (evt.isSidechain) {
        shouldReclassify = true
      } else if (
        s &&
        (agent
          ? !agent.isEntryPoint
          : // Agent roster may not be registered yet (agency startup race) —
            // trust the broadcast's own entry-point flag when present.
            payload.isEntryPoint !== undefined
            ? !payload.isEntryPoint
            : agentKey !== sessionId)
      ) {
        const prior = s.agentEvents[agentKey] ?? []
        shouldReclassify = !prior.some(
          (e) => e.kind === 'user' || e.systemSubtype === 'delegated-task',
        )
      }

      if (shouldReclassify) {
        evt = { ...evt, kind: 'system', role: 'system', systemSubtype: 'delegated-task' }
      }
    }

    const s = sessions[sessionId]
    if (s) {
      if (!s.agentEvents[agentKey]) s.agentEvents[agentKey] = []
      const agentEvts = s.agentEvents[agentKey]!
      const partialIdx = streamingPartials[agentKey]
      if (partialIdx !== undefined && evt.role === 'assistant') {
        agentEvts.splice(partialIdx, 1, evt)
        // Sync with s.events (find the partial by reference or index)
        const globalIdx = s.events.lastIndexOf(agentEvts[partialIdx] ?? evt)
        if (globalIdx >= 0) s.events.splice(globalIdx, 1, evt)
        else s.events.push(evt)
        delete streamingPartials[agentKey]
      } else {
        agentEvts.push(evt)
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
      ensureBuffer(sessionId).events.push({ agentLocalId: payload.agentLocalId ?? null, event: evt })
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
      if (!dailyUsage[key]) dailyUsage[key] = { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
      dailyUsage[key]!.tokens += tokens
      dailyUsage[key]!.costUsd += costUsd
      dailyUsage[key]!.inputTokens += u.inputTokens
      dailyUsage[key]!.outputTokens += u.outputTokens
      dailyUsage[key]!.cacheReadTokens += u.cacheReadInputTokens
      dailyUsage[key]!.cacheCreationTokens += u.cacheCreationInputTokens

      // Per-project daily accumulation — mirrors the global roll-up so the
      // dashboard can scope Token Activity to the selected project.
      const projectPath = sessions[u.sessionId]?.projectPath
      if (projectPath) {
        const projMap = dailyUsageByProject[projectPath] ?? (dailyUsageByProject[projectPath] = {})
        if (!projMap[key]) projMap[key] = { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
        projMap[key]!.tokens += tokens
        projMap[key]!.costUsd += costUsd
        projMap[key]!.inputTokens += u.inputTokens
        projMap[key]!.outputTokens += u.outputTokens
        projMap[key]!.cacheReadTokens += u.cacheReadInputTokens
        projMap[key]!.cacheCreationTokens += u.cacheCreationInputTokens
      }

      // Session-level accumulation
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

      // Per-agent accumulation
      if (!agentTokens[u.agentLocalId]) {
        agentTokens[u.agentLocalId] = { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
      }
      agentTokens[u.agentLocalId]!.tokens += tokens
      agentTokens[u.agentLocalId]!.costUsd += costUsd
      agentTokens[u.agentLocalId]!.inputTokens += u.inputTokens
      agentTokens[u.agentLocalId]!.outputTokens += u.outputTokens
      agentTokens[u.agentLocalId]!.cacheReadTokens += u.cacheReadInputTokens
      agentTokens[u.agentLocalId]!.cacheCreationTokens += u.cacheCreationInputTokens
      agentTokens[u.agentLocalId]!.inputCostUsd += u.inputCostUsd
      agentTokens[u.agentLocalId]!.outputCostUsd += u.outputCostUsd
      agentTokens[u.agentLocalId]!.cacheReadCostUsd += u.cacheReadCostUsd
      agentTokens[u.agentLocalId]!.cacheCreationCostUsd += u.cacheCreationCostUsd

      sessionTurns[u.sessionId] = (sessionTurns[u.sessionId] ?? 0) + 1

      sessionRunTokens[u.agentLocalId] = 0
      sessionOutputEstimates[u.agentLocalId] = 0
      void window.agentkeeper.stats.upsert(
        u.sessionId,
        sessionTokens[u.sessionId]!.tokens,
        sessionTokens[u.sessionId]!.costUsd,
        sessionTurns[u.sessionId] ?? 0,
        0,
      )
    }
  })

  window.agentkeeper.sessions.onStatus((update) => {
    const s = sessions[update.sessionId]
    if (s) {
      const prevStatus = s.status
      if (update.agentLocalId) {
        // Agent-level update
        const agent = s.agents.find(a => a.localId === update.agentLocalId)
        if (agent) {
          if (update.status != null) agent.status = update.status
          if (update.sdkSessionId) agent.sdkSessionId = update.sdkSessionId
          agent.lastActivityAt = Date.now()
        }
        if (update.status != null) {
          // Recompute session status from all agents
          const rollup = computeSessionStatus(s.agents)
          const preserveBlocked = s.status === 'blocked' && (rollup === 'idle' || rollup === 'starting')
          if (!preserveBlocked) s.status = rollup
        }
      } else {
        // Session-level update
        if (update.status != null) {
          const preserveBlocked =
            s.status === 'blocked' &&
            (update.status === 'idle' || update.status === 'starting')
          if (!preserveBlocked) s.status = update.status
        }
      }

      const isNowActive = s.status === 'running' || s.status === 'starting'
      const wasActive = prevStatus === 'running' || prevStatus === 'starting'
      if (isNowActive && !wasActive) {
        s.currentTurnStartedAt = Date.now()
        s.currentTurnEndedAt = null
      } else if (!isNowActive && wasActive) {
        s.currentTurnEndedAt = Date.now()
      }

      // Rescue any in-progress tokens on quiescent status
      const quiescent =
        update.status === 'idle' ||
        update.status === 'completed' ||
        update.status === 'inactive' ||
        update.status === 'suspended' ||
        update.status === 'error'
      const agentKey = update.agentLocalId ?? update.sessionId
      const partial = quiescent ? (sessionRunTokens[agentKey] ?? 0) : 0
      if (partial > 0) {
        if (!sessionTokens[update.sessionId]) {
          sessionTokens[update.sessionId] = { tokens: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, inputCostUsd: 0, outputCostUsd: 0, cacheReadCostUsd: 0, cacheCreationCostUsd: 0 }
        }
        sessionTokens[update.sessionId]!.tokens += partial
        sessionRunTokens[agentKey] = 0
        sessionOutputEstimates[agentKey] = 0
        void window.agentkeeper.stats.upsert(
          update.sessionId,
          sessionTokens[update.sessionId]!.tokens,
          sessionTokens[update.sessionId]!.costUsd ?? 0,
          sessionTurns[update.sessionId] ?? 0,
          0,
        )
      }

      if (update.title) s.title = update.title
      if (update.error) s.error = update.error
      s.lastActivityAt = Date.now()

      const newStatus = s.status
      if (
        (newStatus === 'idle' || newStatus === 'completed') &&
        newStatus !== prevStatus &&
        prevStatus !== 'idle' && prevStatus !== 'completed'
      ) {
        void triggerSessionNotification(s.localId, s.title ?? s.localId)
      }
    } else {
      const buf = ensureBuffer(update.sessionId)
      if (update.status != null) buf.status = update.status
      if (update.sdkSessionId) {
        buf.sdkSessionId = update.sdkSessionId
        buf.agentLocalId = update.agentLocalId ?? null
      }
      if (update.error) buf.error = update.error
    }
  })

  // Sessions created by another client (mobile, agency orchestrator) aren't in
  // the store yet. Pull the row and track it so it appears app-wide.
  const unsubCreated = window.agentkeeper.sessions.onCreated((localId) => {
    if (sessions[localId]) return
    void window.agentkeeper.sessions.getByLocalId(localId).then((s) => {
      if (s && !sessions[localId]) trackRunning(s)
    })
  })
  onScopeDispose(unsubCreated)

  // Sessions deleted by another client (mobile) linger in the store otherwise.
  // dismiss() is idempotent, so the initiating renderer is unaffected.
  const unsubDeleted = window.agentkeeper.sessions.onDeleted((localId) => {
    if (sessions[localId]) dismiss(localId)
  })
  onScopeDispose(unsubDeleted)

  const unsubNavigate = window.agentkeeper.notifications?.onNavigate((sessionLocalId) => {
    void router.push(`/sessions/${sessionLocalId}`)
  })
  if (unsubNavigate) onScopeDispose(unsubNavigate)

  // ─── Edit / regenerate ──────────────────────────────────────────────────────

  function truncateAgentEventsAt(
    sessionLocalId: string,
    agentLocalId: string,
    fromUuid: string,
  ): TranscriptEvent[] {
    const s = sessions[sessionLocalId]
    if (!s) return []
    const agentEvts = s.agentEvents[agentLocalId]
    if (!agentEvts) return []
    const cutIndex = agentEvts.findIndex((e) => e.uuid === fromUuid)
    if (cutIndex === -1) return []
    const removed = agentEvts.splice(cutIndex)
    const removedUuids = new Set(removed.map((e) => e.uuid))
    for (let i = s.events.length - 1; i >= 0; i--) {
      if (removedUuids.has(s.events[i]!.uuid)) s.events.splice(i, 1)
    }
    if (streamingPartials[agentLocalId] !== undefined &&
        streamingPartials[agentLocalId]! >= cutIndex) {
      delete streamingPartials[agentLocalId]
    }
    return removed
  }

  async function editAndRerun(
    agentLocalId: string,
    truncateFromUuid: string,
    newText: string,
  ): Promise<TranscriptEvent[]> {
    const sessionEntry = Object.values(sessions).find((s) =>
      s.agents.some((a) => a.localId === agentLocalId),
    )
    if (!sessionEntry) return []
    const target = sessionEntry.agentEvents[agentLocalId]?.find((e) => e.uuid === truncateFromUuid)
    const originalText = target
      ? target.content
          .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
          .map((b) => b.text)
          .join('\n') || null
      : null
    // Re-send image blocks from the edited message so attachments survive the edit.
    const attachments: Attachment[] = []
    if (target) {
      for (const b of target.content) {
        if (b.type !== 'image') continue
        const src = b.source as { type?: string; media_type?: string; data?: string } | null
        if (src?.type === 'base64' && src.media_type && src.data) {
          const ext = src.media_type.split('/')[1] ?? 'png'
          attachments.push({
            name: `image-${attachments.length + 1}.${ext}`,
            mimeType: src.media_type,
            content: src.data,
          })
        }
      }
    }
    const removed = truncateAgentEventsAt(sessionEntry.localId, agentLocalId, truncateFromUuid)
    await window.agentkeeper.sessions.editAndRerun(
      agentLocalId,
      truncateFromUuid,
      newText,
      originalText,
      attachments.length > 0 ? attachments : undefined,
    )
    return removed
  }

  async function undoEditAndRerun(
    agentLocalId: string,
    sessionLocalId: string,
    removedEvents: TranscriptEvent[],
  ): Promise<void> {
    await window.agentkeeper.sessions.undoEditAndRerun(agentLocalId)
    const s = sessions[sessionLocalId]
    if (!s || removedEvents.length === 0) return
    const agentEvts = s.agentEvents[agentLocalId]
    if (agentEvts) agentEvts.push(...removedEvents)
    s.events.push(...removedEvents)
  }

  watch(currentLiveId, () => {
    const nonEvictable = new Set(['running', 'starting', 'blocked'])
    for (const [id, s] of Object.entries(sessions)) {
      if (id === currentLiveId.value) continue
      if (nonEvictable.has(s.status)) continue
      s.events = []
      for (const key of Object.keys(s.agentEvents)) {
        s.agentEvents[key] = []
      }
    }
    // Re-load transcript for the newly-active session if events were evicted.
    const id = currentLiveId.value
    if (!id) return
    const s = sessions[id]
    if (!s) return
    for (const agent of s.agents) {
      if (agent.sdkSessionId && !s.agentEvents[agent.localId]?.length) {
        void loadAgentTranscriptFromDisk(id, agent.localId, s.projectPath, agent.sdkSessionId)
      }
    }
  })

  return {
    sessions,
    sessionTokens,
    agentTokens,
    sessionTurns,
    sessionRunTokens,
    sessionOutputEstimates,
    streamingPartials,
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
    trackRunning,
    openHistorical,
    openPersistedAgency,
    resumeFromHistory,
    createOrFocusDraft,
    retargetDraft,
    setDraftMessage,
    promoteDraft,
    visibleSessions,
    statusCounts,
    subAgentCount,
    tokenStats,
    tokenStatsFor,
    activeAgentCount,
    runningSessionCount,
    editAndRerun,
    undoEditAndRerun,
  }
})
