<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  Brain,
  ChevronDown,
  KeyRound,
  LayoutGrid,
  MoreHorizontal,
} from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import Transcript from '@/components/transcript/Transcript.vue'
import VerbosityFilter from '@/components/transcript/VerbosityFilter.vue'
import SessionStatusBar from '@/components/transcript/SessionStatusBar.vue'
import MessageInput from '@/components/MessageInput.vue'
import ModelPicker from '@/components/ModelPicker.vue'
import PillSelect from '@/components/PillSelect.vue'
import ContextPanel from '@/components/session/ContextPanel.vue'
import ScopeBar from '@/components/ScopeBar.vue'
import type { ScopeOption } from '@/composables/usePageScope'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { projectColor } from '@/lib/projectColor'
import {
  DEFAULT_VERBOSITY_STATE,
  MODE_DEFAULTS,
  passesEventFilter,
  type VerbosityState,
  hiddenCount as computeHiddenCount,
} from '@/lib/verbosity'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { isGeneralProject, GENERAL_PROJECT_PATH, type Agency, type Attachment, type PermissionMode, type RoleEffort, type TranscriptEvent } from '@shared/ipc-contract'

interface UndoBuf {
  agentLocalId: string
  sessionLocalId: string
  events: TranscriptEvent[]
  count: number
  timerId: ReturnType<typeof setTimeout> | null
}

const undoBuf = ref<UndoBuf | null>(null)
const rewriteError = ref<string | null>(null)

const props = defineProps<{
  liveId: string
  enterToSend?: boolean
  sendModifier?: 'auto' | 'meta' | 'ctrl' | 'alt' | 'shift'
}>()

const router = useRouter()
const store = useSessionStore()
const { projects, pickAndAdd } = useProjectsQuery()
const messageInputRef = ref<InstanceType<typeof MessageInput> | null>(null)

// Root session — fixed to props.liveId. Used for header title, project name, agent list.
const rootSession = computed(() => store.getSession(props.liveId))

// Selected agent — switches when user clicks a row in the agent tree.
// For solo sessions agentLocalId === sessionLocalId, so getSession falls through correctly.
const selectedAgentLocalId = ref(
  rootSession.value?.agents.find(a => a.isEntryPoint)?.localId ?? props.liveId,
)
const prevLiveId = ref(props.liveId)
const session = computed(
  // For solo sessions: getSession(agentLocalId) === rootSession.
  // For agency sessions: agentLocalId is not a session key → falls back to rootSession.
  () => store.getSession(selectedAgentLocalId.value) ?? rootSession.value,
)

// Events for the currently selected agent's stream.
const agentEvents = computed(() => {
  const root = rootSession.value
  if (!root) return session.value?.events ?? []
  return root.agentEvents[selectedAgentLocalId.value] ?? root.events
})

// ─── Project / title ────────────────────────────────────────────────────────

// Always derived from the root session — the header always shows the top-level task.
const sessionProjectName = computed(() => {
  const path = rootSession.value?.projectPath ?? ''
  if (isGeneralProject(path)) return ''
  return (
    projects.value.find((p) => p.path === path)?.name ??
    path.split('/').filter(Boolean).pop() ??
    ''
  )
})

// General chats have no project scope — hide project/worktree affordances.
const isGeneralSession = computed(() => {
  const path = rootSession.value?.projectPath ?? ''
  return isGeneralProject(path)
})

const sessionTitle = computed(() => {
  const s = rootSession.value
  if (!s) return ''
  return s.title ?? s.agencyName ?? s.initialPrompt ?? props.liveId
})

// ─── Session context (per-session project choice) ────────────────────────────

const contextPath = computed(() => rootSession.value?.projectPath ?? GENERAL_PROJECT_PATH)

const contextScopeLabel = computed(() =>
  isGeneralSession.value ? 'General' : sessionProjectName.value || 'General',
)
const contextScopeColor = computed(() =>
  isGeneralSession.value ? null : projectColor(sessionProjectName.value),
)
const contextOpen = ref(false)

// Options fed to ScopeBar: General + registered projects (it appends "New
// project…" itself). No All/Global — a session runs in exactly one context.
const contextOptions = computed<ScopeOption[]>(() => [
  { value: GENERAL_PROJECT_PATH, label: 'General', kind: 'general' },
  ...[...projects.value]
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .map((p) => ({
      value: p.path,
      label: p.name,
      kind: 'project' as const,
      color: projectColor(p.name),
      path: p.path,
    })),
])

// Draft → re-target in place. Running/terminal session → the context is fixed
// once started; changing it spawns a fresh draft in the chosen context (live
// rebinding of a running SDK session is deferred — a session's worktree/cwd is
// bound at start and can't move mid-flight).
async function changeContext(path: string): Promise<void> {
  if (path === contextPath.value) return
  if (rootIsDraft.value) {
    store.retargetDraft(props.liveId, path)
    return
  }
  const settings = await window.agentkeeper.settings.get()
  const localId = store.createOrFocusDraft({
    projectPath: path,
    defaultModel: settings.defaultModel,
    defaultEffort: settings.defaultEffort,
    defaultUseWorktree: settings.defaultUseWorktree,
  })
  void router.push(`/sessions/${localId}`)
}

async function pickContextProject(): Promise<void> {
  const before = new Set(projects.value.map((p) => p.path))
  await pickAndAdd()
  const added = projects.value.find((p) => !before.has(p.path))
  if (added) void changeContext(added.path)
}

// ─── Scroll tracking ────────────────────────────────────────────────────────

interface TranscriptExpose {
  scrollToEnd: () => void
  scrollTo: (offset: number) => void
  getScrollMetrics: () => { offset: number; scrollSize: number; viewportSize: number } | null
}

const transcriptRef = ref<TranscriptExpose | null>(null)

const isAtBottom = ref(true)
const hasNewMessages = ref(false)
const firstNewScrollHeight = ref(0)
const firstNewEventsLength = ref(0)

const BOTTOM_THRESHOLD = 64

const newMessageCount = computed(() =>
  hasNewMessages.value
    ? Math.max(0, agentEvents.value.length - firstNewEventsLength.value)
    : 0,
)

function onTranscriptScroll(offset: number) {
  const metrics = transcriptRef.value?.getScrollMetrics()
  if (!metrics) return
  isAtBottom.value = metrics.scrollSize - offset - metrics.viewportSize < BOTTOM_THRESHOLD
  if (isAtBottom.value && hasNewMessages.value) {
    hasNewMessages.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  requestAnimationFrame(() => {
    transcriptRef.value?.scrollToEnd()
  })
}

function goToNewMessages() {
  transcriptRef.value?.scrollTo(Math.max(0, firstNewScrollHeight.value - 40))
  hasNewMessages.value = false
}

watch(
  () => agentEvents.value.length,
  (newLen, oldLen) => {
    if (isAtBottom.value) {
      void scrollToBottom()
    } else if (!hasNewMessages.value) {
      firstNewScrollHeight.value = transcriptRef.value?.getScrollMetrics()?.scrollSize ?? 0
      firstNewEventsLength.value = oldLen
      hasNewMessages.value = true
    }
  },
)

// When the route changes, sync currentLiveId so eviction/reload fires, then reset selected agent.
watch(
  () => props.liveId,
  () => {
    store.focus(props.liveId)
    const ep = store.getSession(props.liveId)?.agents.find(a => a.isEntryPoint)
    selectedAgentLocalId.value = ep?.localId ?? props.liveId
  },
  { immediate: true },
)

// ─── Processing status bar ───────────────────────────────────────────────────

const turnStartedAt = computed(() => rootSession.value?.currentTurnStartedAt ?? null)
const turnEndedAt = computed(() => rootSession.value?.currentTurnEndedAt ?? null)

// When the selected agent changes (route change OR tree click), reset UI state
// and save/restore draft messages via the root session (draft keyed by sessionLocalId).
watch(
  selectedAgentLocalId,
  (_newId, _oldId) => {
    if (_oldId && messageInputRef.value) {
      store.setDraftMessage(prevLiveId.value, messageInputRef.value.getText(), messageInputRef.value.getAttachments())
    }
    prevLiveId.value = props.liveId
    void nextTick(() => {
      const s = store.getSession(props.liveId)
      messageInputRef.value?.setText(s?.draftMessage ?? '')
      messageInputRef.value?.setAttachments(s?.draftAttachments ?? [])
    })
    // Reset scroll when switching agents.
    isAtBottom.value = true
    hasNewMessages.value = false
    void scrollToBottom()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (messageInputRef.value) {
    store.setDraftMessage(props.liveId, messageInputRef.value.getText(), messageInputRef.value.getAttachments())
  }
})

// ─── Draft / send ───────────────────────────────────────────────────────────

const isDraft = computed(() => !!session.value?.isDraft)
const promoting = ref(false)
const promoteError = ref<string | null>(null)

// Clear per-session transient errors when the user navigates to a different session.
// LiveSessionView is reused across /sessions/:id navigations without remounting,
// so these refs must be reset manually.
watch(() => props.liveId, () => {
  promoteError.value = null
  rewriteError.value = null
})

async function onSend(text: string, attachments: Attachment[]) {
  if (isDraft.value) {
    if (promoting.value || (!text.trim() && attachments.length === 0)) return
    promoting.value = true
    promoteError.value = null
    try {
      const [roles, agencies] = await Promise.all([
        window.agentkeeper.roles.list(session.value!.projectPath),
        window.agentkeeper.agencies.list(session.value!.projectPath),
      ])
      const focusedId = await store.promoteDraft(props.liveId, text, { roles, agencies }, attachments)
      if (focusedId && focusedId !== props.liveId) {
        void router.replace(`/sessions/${focusedId}`)
      }
    } catch (e) {
      promoteError.value = e instanceof Error ? e.message : String(e)
    } finally {
      promoting.value = false
    }
    return
  }
  store.setDraftMessage(props.liveId, '')
  void store.send(props.liveId, text, attachments)
}

async function onStop() {
  await store.interrupt(selectedAgentLocalId.value)
}

// ─── Edit / regenerate / undo ────────────────────────────────────────────────

async function onEditSubmit(uuid: string, newText: string) {
  const agentLocalId = selectedAgentLocalId.value
  rewriteError.value = null
  try {
    const removed = await store.editAndRerun(agentLocalId, uuid, newText)
    if (undoBuf.value?.timerId) clearTimeout(undoBuf.value.timerId)
    undoBuf.value = {
      agentLocalId,
      sessionLocalId: props.liveId,
      events: removed,
      count: removed.filter((e) => passesEventFilter(e, verbosityState.value)).length,
      timerId: setTimeout(() => { undoBuf.value = null }, 10_000),
    }
  } catch (e) {
    rewriteError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onRegenerate(assistantEventUuid: string) {
  const agentLocalId = selectedAgentLocalId.value
  const events = agentEvents.value
  const assistantIdx = events.findIndex((e) => e.uuid === assistantEventUuid)
  if (assistantIdx === -1) return
  let userEvent: TranscriptEvent | null = null
  for (let i = assistantIdx - 1; i >= 0; i--) {
    const ev = events[i]!
    if (ev.role === 'user' && ev.content.some((b) => b.type === 'text')) {
      userEvent = ev
      break
    }
  }
  if (!userEvent) return
  const textContent = userEvent.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n')
  rewriteError.value = null
  try {
    const removed = await store.editAndRerun(agentLocalId, userEvent.uuid, textContent)
    if (undoBuf.value?.timerId) clearTimeout(undoBuf.value.timerId)
    undoBuf.value = {
      agentLocalId,
      sessionLocalId: props.liveId,
      events: removed,
      count: removed.filter((e) => passesEventFilter(e, verbosityState.value)).length,
      timerId: setTimeout(() => { undoBuf.value = null }, 10_000),
    }
  } catch (e) {
    rewriteError.value = e instanceof Error ? e.message : String(e)
  }
}

async function onUndo() {
  if (!undoBuf.value) return
  const buf = undoBuf.value
  if (buf.timerId) clearTimeout(buf.timerId)
  undoBuf.value = null
  try {
    await store.undoEditAndRerun(buf.agentLocalId, buf.sessionLocalId, buf.events)
  } catch (e) {
    rewriteError.value = e instanceof Error ? e.message : String(e)
  }
}

// ─── Session state helpers ───────────────────────────────────────────────────

const canSend = computed(
  () =>
    isDraft.value ||
    session.value?.status === 'idle' ||
    session.value?.status === 'running' ||
    session.value?.status === 'suspended' ||
    session.value?.status === 'inactive',
)

const wasInterrupted = computed(() => !!session.value?.interruptedAt)

const isTerminal = computed(
  () =>
    session.value?.status === 'completed' ||
    session.value?.status === 'inactive' ||
    session.value?.status === 'error',
)

// Short label shown in the header status badge — always reflects the root session.
const statusBadgeLabel = computed(() => {
  if (rootSession.value?.isDraft) return promoting.value ? 'Starting' : 'Draft'
  switch (rootSession.value?.status) {
    case 'starting':  return 'Starting'
    case 'running':   return 'Running'
    case 'idle':      return 'Idle'
    case 'suspended': return 'Suspended'
    case 'completed': return 'Completed'
    case 'inactive':  return 'Inactive'
    case 'error':     return 'Error'
    default:          return ''
  }
})


const statusDotClass = computed(() => {
  if (rootSession.value?.isDraft) return 'bg-muted-foreground/60'
  switch (rootSession.value?.status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'completed':
    case 'inactive':
      return 'bg-muted-foreground'
    case 'error':
      return 'bg-destructive'
    default:
      return 'bg-muted-foreground'
  }
})

// ─── Three-dot action menu ───────────────────────────────────────────────────

const actionsMenuOpen = ref(false)

// Guards for header menu actions — always derived from the root session so the
// menu reflects the overall task state regardless of which sub-agent is selected.
const rootIsRunning = computed(
  () => rootSession.value?.status === 'running' || rootSession.value?.status === 'starting',
)
const rootIsTerminal = computed(
  () =>
    rootSession.value?.status === 'completed' ||
    rootSession.value?.status === 'inactive' ||
    rootSession.value?.status === 'error',
)
const rootIsDraft = computed(() => !!rootSession.value?.isDraft)

async function interruptRoot() {
  actionsMenuOpen.value = false
  await store.interrupt(props.liveId)
}

async function endRoot() {
  actionsMenuOpen.value = false
  await store.terminate(props.liveId)
}

function removeFromList() {
  actionsMenuOpen.value = false
  store.dismiss(props.liveId)
  void router.push('/sessions')
}

// ─── Model / effort / permission selectors ───────────────────────────────────

const { effortLevelsFor, models: availableModels, defaultValue: defaultModel } = useModelsQuery()

const PERM_MODE_LABELS: Record<PermissionMode, string> = {
  bypassPermissions: 'Bypass',
  acceptEdits: 'Accept Edits',
  default: 'Default',
  plan: 'Plan',
}

const effortOptions = computed(() => [
  { value: '', label: 'default' },
  ...effortLevelsFor(session.value?.model).map((e) => ({ value: e, label: e })),
])

const permModeOptions = Object.entries(PERM_MODE_LABELS).map(
  ([value, label]) => ({ value, label }),
)

const canEditParams = computed(() => {
  if (isDraft.value) return true
  const s = session.value?.status
  return s === 'idle' || s === 'suspended'
})

// Agency sessions: role instances set their own model/effort and always run
// bypassPermissions (see orchestrator.ts) — the session-level pills don't apply.
const isAgencySession = computed(() => {
  if (isDraft.value) return !!draftCfg.value?.agencyKey
  return !!session.value?.agencyName
})

// ─── Draft config ──────────────────────────────────────────────────────────────

const draftAgencies = ref<Agency[]>([])

async function loadDraftAgencies() {
  try {
    draftAgencies.value = await window.agentkeeper.agencies.list(session.value?.projectPath ?? '')
  } catch {
    draftAgencies.value = []
  }
}

watch(() => session.value?.projectPath, () => {
  if (isDraft.value) void loadDraftAgencies()
}, { immediate: true })

watch(isDraft, (v) => { if (v) void loadDraftAgencies() })

const agencyOptions = computed(() => [
  { value: '', label: 'No agency' },
  ...draftAgencies.value.map((a) => ({ value: `${a.scope}:${a.id}`, label: a.name })),
])

const draftCfg = computed(() => session.value?.draftConfig ?? null)

const PERM_SHORT: Record<PermissionMode, string> = {
  bypassPermissions: 'bypass',
  acceptEdits: 'accept-edits',
  default: 'default',
  plan: 'plan',
}

const draftConfigSummary = computed(() => {
  const s = session.value
  if (!s) return ''
  const worktreePart = draftCfg.value?.useWorktree ? (draftCfg.value.branch || 'worktree') : 'no worktree'
  if (isAgencySession.value) return ['agency', s.model ?? 'claude-code', worktreePart].join(' · ')
  return [
    s.model ?? 'claude-code',
    s.effort ?? 'medium',
    PERM_SHORT[s.permissionMode ?? 'bypassPermissions'],
    worktreePart,
  ].join(' · ')
})

watch([availableModels, () => session.value?.model], () => {
  if (!isDraft.value) return
  if (!availableModels.value.length) return
  const m = session.value?.model
  if (m && !availableModels.value.some(x => x.value === m)) {
    if (session.value) session.value.model = defaultModel.value
  }
}, { immediate: true })

async function changeModel(model: string) {
  if (!session.value) return
  if (isDraft.value) { session.value.model = model; return }
  if (isAgencySession.value) {
    await window.agentkeeper.agencies.setFallbackModel(session.value.localId, model)
  } else {
    await window.agentkeeper.sessions.setModel(session.value.localId, model)
  }
  session.value.model = model
}

async function changeEffort(val: string) {
  if (!val || !session.value) return
  if (isDraft.value) { session.value.effort = val as RoleEffort; return }
  await window.agentkeeper.sessions.setEffort(session.value.localId, val as RoleEffort)
  session.value.effort = val as RoleEffort
}

async function changePermissionMode(mode: PermissionMode) {
  if (!session.value) return
  if (isDraft.value) { session.value.permissionMode = mode; return }
  await window.agentkeeper.sessions.setPermissionMode(session.value.localId, mode)
  session.value.permissionMode = mode
}

// ─── Verbosity filter ────────────────────────────────────────────────────────

const verbosityState = ref<VerbosityState>({
  mode: DEFAULT_VERBOSITY_STATE.mode,
  toggles: { ...DEFAULT_VERBOSITY_STATE.toggles },
})

const totalHiddenCount = computed(() =>
  computeHiddenCount(agentEvents.value, verbosityState.value)
)

function onShowAll() {
  verbosityState.value = { mode: 'verbose', toggles: { ...MODE_DEFAULTS.verbose } }
}

// ─── Side panel collapse (persisted via localStorage) ────────────────────────

const PANEL_KEY = 'agentkeeper.ui.panels'

function readPanelCollapsed(name: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(`${PANEL_KEY}.${name}`)
    return v === null ? defaultValue : v === 'true'
  } catch {
    return defaultValue
  }
}

function writePanelCollapsed(name: string, value: boolean) {
  try {
    localStorage.setItem(`${PANEL_KEY}.${name}`, String(value))
  } catch {
    // non-fatal
  }
}

const rightCollapsed = ref(readPanelCollapsed('right', false))

function setRightCollapsed(v: boolean) {
  rightCollapsed.value = v
  writePanelCollapsed('right', v)
}

const currentTool = computed((): { name: string; input: unknown } | null => {
  const s = session.value
  if (!s || (s.status !== 'running' && s.status !== 'starting')) return null
  const evts = agentEvents.value
  for (let i = evts.length - 1; i >= 0; i--) {
    const evt = evts[i]
    if (!evt) continue
    for (let j = evt.content.length - 1; j >= 0; j--) {
      const block = evt.content[j]
      if (block?.type === 'tool_use') return { name: block.name, input: block.input }
    }
  }
  return null
})

const streamingEventUuid = computed((): string | undefined => {
  const s = session.value
  if (!s || (s.status !== 'running' && s.status !== 'starting')) return undefined
  const evts = agentEvents.value
  for (let i = evts.length - 1; i >= 0; i--) {
    const evt = evts[i]
    if (evt && evt.role === 'assistant') return evt.uuid
  }
  return undefined
})

</script>

<template>
  <div v-if="session" class="h-full flex overflow-hidden">

    <!-- ── Center column: Chat ────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- Header -->
      <header class="border-b border-border px-3 h-10 shrink-0 flex items-center gap-2">
        <!-- Session title -->
        <h1 class="text-sm font-medium truncate flex-1 min-w-0">
          {{ sessionTitle }}
        </h1>

        <!-- Pills + actions -->
        <div class="flex items-center gap-1.5 shrink-0">
          <!-- Context control — colored badge, click to change the session's
               project context (draft re-targets, live starts a new session) -->
          <ScopeBar
            v-model:open="contextOpen"
            :scope="contextPath"
            :options="contextOptions"
            :label="contextScopeLabel"
            :color="contextScopeColor"
            @select="changeContext"
            @pick-and-add="pickContextProject"
          />

          <!-- Ticket pill — always from root session -->
          <span
            v-if="rootSession?.workItemKey"
            class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground"
          >
            {{ rootSession.workItemKey }}
          </span>

          <!-- Status badge — always from root session -->
          <span
            v-if="statusBadgeLabel"
            class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
          >
            <span class="size-1.5 rounded-full shrink-0" :class="statusDotClass" />
            {{ statusBadgeLabel }}
          </span>

          <!-- Monitor grid icon -->
          <button
            class="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="View in monitor"
            @click="router.push('/monitor')"
          >
            <LayoutGrid class="size-3.5" />
          </button>

          <!-- Three-dot action menu -->
          <Popover v-model:open="actionsMenuOpen">
            <PopoverTrigger as-child>
              <button
                class="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
                title="Session actions"
              >
                <MoreHorizontal class="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-44 p-1">
              <!-- Interrupt — only when root session is actively running -->
              <button
                v-if="rootIsRunning"
                class="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-muted transition-colors"
                @click="interruptRoot"
              >
                Interrupt
              </button>

              <!-- End session — when root is live (not terminal, not draft) -->
              <button
                v-if="!rootIsDraft && !rootIsTerminal"
                class="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-muted transition-colors"
                @click="endRoot"
              >
                End session
              </button>

              <!-- Separator before destructive action -->
              <div
                v-if="!rootIsDraft"
                class="my-1 border-t border-border/50"
              />

              <!-- Remove — always available -->
              <button
                class="w-full text-left text-sm px-3 py-1.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                @click="removeFromList"
              >
                {{ rootIsDraft ? 'Discard draft' : 'Remove from list' }}
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <!-- "Working in" strip — the session's context at a glance -->
      <div class="border-b border-border/50 px-4 py-1 shrink-0 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span
          v-if="contextScopeColor"
          class="size-2 rounded-full shrink-0"
          :style="{ backgroundColor: contextScopeColor }"
        />
        <template v-if="isGeneralSession">
          <span>General — no repository attached</span>
        </template>
        <template v-else>
          <span class="font-medium text-foreground">{{ contextScopeLabel }}</span>
          <span v-if="rootSession?.branch" class="font-mono">· {{ rootSession.branch }}</span>
          <span class="font-mono truncate">· {{ contextPath }}</span>
        </template>
      </div>

      <!-- Verbosity filter toolbar — only for live sessions -->
      <div
        v-if="!isDraft"
        class="border-b border-border/50 px-4 py-1.5 shrink-0 flex items-center justify-between"
      >
        <VerbosityFilter
          :model-value="verbosityState"
          :hidden-count="totalHiddenCount"
          @update:model-value="verbosityState = $event"
        />
      </div>

      <!-- Transcript area -->
      <div class="flex-1 relative min-h-0">
        <div class="h-full flex flex-col overflow-hidden">
          <div v-if="session.error || promoteError" class="max-w-4xl mx-auto p-6 w-full shrink-0">
            <div
              class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {{ session.error || promoteError }}
            </div>
          </div>
          <div v-if="isDraft" class="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
            <h2 class="text-lg font-semibold">
              {{ isGeneralSession ? 'What can I help with?' : `Working in ${contextScopeLabel}` }}
            </h2>
            <p class="text-sm text-muted-foreground">
              Type the first message to start the session.
              <template v-if="!isGeneralSession"> Change context from the badge above.</template>
            </p>
            <p class="text-[11px] text-muted-foreground/60 font-mono">{{ draftConfigSummary }}</p>
          </div>
          <Transcript
            v-else
            ref="transcriptRef"
            :events="agentEvents"
            :role-name="rootSession?.agents.find(a => a.localId === selectedAgentLocalId)?.roleName ?? null"
            :verbosity-state="verbosityState"
            :streaming-event-uuid="streamingEventUuid"
            :can-rewrite="!isDraft"
            class="flex-1 min-h-0"
            @show-all="onShowAll"
            @edit-submit="onEditSubmit"
            @regenerate="onRegenerate"
            @scroll="onTranscriptScroll"
          />
        </div>

        <!-- Floating "N new messages" pill -->
        <Transition
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition-all duration-150 ease-in"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 translate-y-2"
        >
          <button
            v-if="hasNewMessages"
            class="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            @click="goToNewMessages"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
            {{ newMessageCount }} new {{ newMessageCount === 1 ? 'message' : 'messages' }}
          </button>
        </Transition>
      </div>

      <!-- Processing status bar -->
      <SessionStatusBar
        v-if="!isDraft"
        :status="session.status"
        :current-tool="currentTool"
        :turn-started-at="turnStartedAt"
        :turn-ended-at="turnEndedAt"
      />

      <!-- Message input -->
      <MessageInput
        ref="messageInputRef"
        :disabled="(!isDraft && (isTerminal || session.status === 'starting')) || promoting"
        :is-running="!isDraft && session.status === 'running'"
        :enter-to-send="props.enterToSend"
        :send-modifier="props.sendModifier"
        :project-path="session.projectPath"
        :role-name="rootSession?.agents.find(a => a.localId === selectedAgentLocalId)?.roleName ?? null"
        :agency-name="session.agencyName"
        :placeholder="
          isDraft
            ? promoting
              ? 'Starting…'
              : 'Type the first message to start the session…'
            : session.status === 'starting'
              ? 'Waiting for session to start…'
              : isTerminal
                ? 'Session ended'
                : wasInterrupted
                  ? 'Send a message to continue, or end the session'
                  : undefined
        "
        @send="onSend"
        @stop="onStop"
      >
        <template #toolbar-left>
          <!-- Agency pill — draft only -->
          <div v-if="isDraft" class="flex items-center gap-0.5 shrink-0">
            <PillSelect
              :model-value="draftCfg?.agencyKey ?? ''"
              :options="agencyOptions"
              @update:model-value="draftCfg && (draftCfg.agencyKey = $event)"
            />
          </div>
          <!-- Worktree pill — draft only -->
          <div v-if="isDraft && !isGeneralSession" class="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              class="text-[11px] text-muted-foreground bg-transparent border-none outline-none cursor-pointer hover:text-foreground transition-colors"
              :class="draftCfg?.useWorktree ? 'text-foreground' : ''"
              @click="draftCfg && (draftCfg.useWorktree = !draftCfg.useWorktree)"
            >
              {{ draftCfg?.useWorktree ? (draftCfg.branch || 'worktree') : 'No worktree' }}
            </button>
          </div>
          <div v-if="!isAgencySession" class="flex items-center gap-0.5 shrink-0">
            <Brain :size="13" class="text-muted-foreground shrink-0" />
            <PillSelect
              :model-value="session.effort ?? ''"
              :options="effortOptions"
              :disabled="!canEditParams"
              trigger-class="max-w-[72px]"
              @update:model-value="changeEffort"
            />
          </div>
          <div
            class="flex items-center gap-0.5 shrink-0"
            :title="isAgencySession ? 'Agency roles always run with bypassed permissions' : undefined"
          >
            <KeyRound :size="13" class="text-muted-foreground shrink-0" />
            <PillSelect
              :model-value="isAgencySession ? 'bypassPermissions' : (session.permissionMode ?? 'bypassPermissions')"
              :options="permModeOptions"
              :disabled="isAgencySession || !canEditParams"
              trigger-class="max-w-[92px]"
              @update:model-value="changePermissionMode($event as PermissionMode)"
            />
          </div>
          <div :title="isAgencySession ? 'Fallback model for agency roles that don\'t set their own' : undefined">
            <ModelPicker
              :model-value="session.model ?? ''"
              :disabled="!canEditParams"
              align="end"
              @update:model-value="changeModel"
            >
              <template #trigger="{ label }">
                <button
                  type="button"
                  :disabled="!canEditParams"
                  class="flex items-center gap-1 text-[11px] text-muted-foreground font-mono bg-transparent border-none outline-none max-w-[110px] shrink-0"
                  :class="canEditParams ? 'cursor-pointer hover:text-foreground' : 'opacity-50 cursor-not-allowed'"
                >
                  <span class="truncate">{{ label }}</span>
                  <ChevronDown class="h-3 w-3 shrink-0" />
                </button>
              </template>
            </ModelPicker>
          </div>
        </template>
      </MessageInput>
    </div>

    <!-- ── Right column: Context ───────────────────────────────────────────── -->
    <ContextPanel
      :collapsed="rightCollapsed"
      :root-session-id="props.liveId"
      :selected-id="selectedAgentLocalId"
      @collapse="setRightCollapsed(true)"
      @expand="setRightCollapsed(false)"
      @update:selected-id="selectedAgentLocalId = $event"
    />

  </div>

  <!-- Session not found -->
  <div v-else class="h-full flex items-center justify-center text-muted-foreground text-sm">
    Session not found.
  </div>

  <!-- Rewrite error -->
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition-all duration-150 ease-in"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="rewriteError"
      class="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive shadow-lg"
    >
      {{ rewriteError }}
      <button class="ml-2 underline" @click="rewriteError = null">Dismiss</button>
    </div>
  </Transition>

  <!-- Undo toast -->
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition-all duration-150 ease-in"
    leave-to-class="opacity-0 translate-y-2"
  >
    <div
      v-if="undoBuf"
      class="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg border border-popover-border bg-popover px-4 py-2.5 text-sm shadow-overlay"
    >
      <span class="text-muted-foreground">
        {{ undoBuf.count }} {{ undoBuf.count === 1 ? 'message' : 'messages' }} removed.
      </span>
      <button
        class="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        @click="onUndo"
      >
        Undo
      </button>
    </div>
  </Transition>
</template>
