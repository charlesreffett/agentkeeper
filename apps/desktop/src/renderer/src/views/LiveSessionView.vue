<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowLeft,
  Brain,
  KeyRound,
  LayoutGrid,
  MoreHorizontal,
  PanelBottomClose,
  PanelBottomOpen,
} from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import Transcript from '@/components/transcript/Transcript.vue'
import VerbosityFilter from '@/components/transcript/VerbosityFilter.vue'
import SessionStatusBar from '@/components/transcript/SessionStatusBar.vue'
import MessageInput from '@/components/MessageInput.vue'
import DraftSessionPanel from '@/views/DraftSessionPanel.vue'
import AgentTreePanel from '@/components/session/AgentTreePanel.vue'
import ContextPanel from '@/components/session/ContextPanel.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import {
  DEFAULT_VERBOSITY_STATE,
  MODE_DEFAULTS,
  type VerbosityState,
  hiddenCount as computeHiddenCount,
} from '@/lib/verbosity'
import {
  ROLE_EFFORT_VALUES,
  type Attachment,
  type PermissionMode,
  type RoleEffort,
  type TranscriptEvent,
} from '@shared/ipc-contract'

const props = defineProps<{
  liveId: string
  enterToSend?: boolean
  sendModifier?: 'auto' | 'meta' | 'ctrl' | 'alt' | 'shift'
}>()

const router = useRouter()
const store = useSessionStore()
const projectsStore = useProjectsStore()
const messageInputRef = ref<InstanceType<typeof MessageInput> | null>(null)

// Root session — fixed to props.liveId. Used for header title, project name, agency group key.
const rootSession = computed(() => store.getSession(props.liveId))

// Selected agent — switches when user clicks a row in the agent tree.
// All transcript/status/input operations target this session.
const selectedAgentLocalId = ref(props.liveId)
const session = computed(
  () => store.getSession(selectedAgentLocalId.value) ?? rootSession.value,
)

// ─── Project / title ────────────────────────────────────────────────────────

// Always derived from the root session — the header always shows the top-level task.
const sessionProjectName = computed(() => {
  const path = rootSession.value?.projectPath ?? ''
  return (
    projectsStore.projects.find((p) => p.path === path)?.name ??
    path.split('/').filter(Boolean).pop() ??
    ''
  )
})

const sessionTitle = computed(() => {
  const s = rootSession.value
  if (!s) return ''
  return s.title ?? s.agencyName ?? s.roleName ?? s.initialPrompt ?? props.liveId
})

// ─── Scroll tracking ────────────────────────────────────────────────────────

const scroller = ref<HTMLElement | null>(null)
const historicalEvents = ref<TranscriptEvent[]>([])
const isResumed = computed(() => !!session.value?.resumedFromSdkSessionId)

const isAtBottom = ref(true)
const hasNewMessages = ref(false)
const firstNewScrollHeight = ref(0)
const firstNewEventsLength = ref(0)

const BOTTOM_THRESHOLD = 64

const newMessageCount = computed(() =>
  hasNewMessages.value
    ? Math.max(0, (session.value?.events.length ?? 0) - firstNewEventsLength.value)
    : 0,
)

function onScroll() {
  const el = scroller.value
  if (!el) return
  isAtBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
  if (isAtBottom.value && hasNewMessages.value) {
    hasNewMessages.value = false
  }
}

async function scrollToBottom() {
  await nextTick()
  requestAnimationFrame(() => {
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

function goToNewMessages() {
  const el = scroller.value
  if (!el) return
  el.scrollTo({ top: Math.max(0, firstNewScrollHeight.value - 40), behavior: 'smooth' })
  hasNewMessages.value = false
}

watch(
  () => session.value?.events.length ?? 0,
  (newLen, oldLen) => {
    if (isAtBottom.value) {
      void scrollToBottom()
    } else if (!hasNewMessages.value) {
      firstNewScrollHeight.value = scroller.value?.scrollHeight ?? 0
      firstNewEventsLength.value = oldLen
      hasNewMessages.value = true
    }
  },
)

// When the route session changes, reset the selected agent to match.
watch(
  () => props.liveId,
  (newId) => {
    selectedAgentLocalId.value = newId
  },
)

// ─── Processing status bar ───────────────────────────────────────────────────

const turnStartedAt = ref<number | null>(null)
const turnEndedAt = ref<number | null>(null)

// When the selected agent changes (route change OR tree click), reset UI state
// and save/restore draft messages for the respective sessions.
watch(
  selectedAgentLocalId,
  (newId, oldId) => {
    if (oldId && messageInputRef.value) {
      store.setDraftMessage(oldId, messageInputRef.value.getText())
    }
    void nextTick(() => {
      const s = store.getSession(newId)
      messageInputRef.value?.setText(s?.draftMessage ?? '')
    })
    // Reset scroll and turn timing when switching agents.
    isAtBottom.value = true
    hasNewMessages.value = false
    turnStartedAt.value = null
    turnEndedAt.value = null
    void scrollToBottom()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (messageInputRef.value) {
    store.setDraftMessage(selectedAgentLocalId.value, messageInputRef.value.getText())
  }
})

onMounted(async () => {
  const s = session.value
  if (s?.resumedFromSdkSessionId) {
    try {
      const transcript = await window.agentkeeper.sessions.read(
        s.projectPath,
        s.resumedFromSdkSessionId,
      )
      if (transcript) {
        historicalEvents.value = transcript.events
        void scrollToBottom()
      }
    } catch {
      // non-fatal — live events still work
    }
  }
})

// ─── Draft / send ───────────────────────────────────────────────────────────

const isDraft = computed(() => !!session.value?.isDraft)
const promoting = ref(false)
const promoteError = ref<string | null>(null)

async function onSend(text: string, attachments: Attachment[]) {
  if (isDraft.value) {
    if (promoting.value || !text.trim()) return
    promoting.value = true
    promoteError.value = null
    try {
      const [roles, agencies] = await Promise.all([
        window.agentkeeper.roles.list(session.value!.projectPath),
        window.agentkeeper.agencies.list(session.value!.projectPath),
      ])
      await store.promoteDraft(props.liveId, text, { roles, agencies }, attachments)
    } catch (e) {
      promoteError.value = e instanceof Error ? e.message : String(e)
    } finally {
      promoting.value = false
    }
    return
  }
  store.setDraftMessage(selectedAgentLocalId.value, '')
  void store.send(selectedAgentLocalId.value, text, attachments)
}

async function onStop() {
  await store.interrupt(selectedAgentLocalId.value)
}


// ─── Session state helpers ───────────────────────────────────────────────────

const canSend = computed(
  () =>
    isDraft.value ||
    session.value?.status === 'idle' ||
    session.value?.status === 'running' ||
    session.value?.status === 'suspended',
)

const wasInterrupted = computed(() => !!session.value?.interruptedAt)

const isTerminal = computed(
  () =>
    session.value?.status === 'completed' ||
    session.value?.status === 'terminated' ||
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
    case 'terminated':return 'Terminated'
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
    case 'terminated':
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
    rootSession.value?.status === 'terminated' ||
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

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

const PERM_MODE_LABELS: Record<PermissionMode, string> = {
  bypassPermissions: 'Bypass',
  acceptEdits: 'Accept Edits',
  default: 'Default',
  plan: 'Plan',
}

const canEditParams = computed(() => {
  const s = session.value?.status
  return s === 'idle' || s === 'suspended'
})

async function changeModel(model: string) {
  if (!session.value) return
  await window.agentkeeper.sessions.setModel(session.value.localId, model)
  session.value.model = model
}

async function changeEffort(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  if (!val || !session.value) return
  await window.agentkeeper.sessions.setEffort(session.value.localId, val as RoleEffort)
  session.value.effort = val as RoleEffort
}

async function changePermissionMode(mode: PermissionMode) {
  if (!session.value) return
  await window.agentkeeper.sessions.setPermissionMode(session.value.localId, mode)
  session.value.permissionMode = mode
}

// ─── Verbosity filter ────────────────────────────────────────────────────────

const verbosityState = ref<VerbosityState>({
  mode: DEFAULT_VERBOSITY_STATE.mode,
  toggles: { ...DEFAULT_VERBOSITY_STATE.toggles },
})

const totalHiddenCount = computed(() => {
  const s = session.value
  if (!s) return 0
  return computeHiddenCount(s.events, verbosityState.value)
})

function onShowAll() {
  verbosityState.value = { mode: 'verbose', toggles: { ...MODE_DEFAULTS.verbose } }
}

// ─── Status bar collapse (persisted via localStorage) ────────────────────────

const STATUS_BAR_KEY = 'agentkeeper.ui.statusBarExpanded'

function readStatusBarExpanded(): boolean {
  try {
    const v = localStorage.getItem(STATUS_BAR_KEY)
    return v === null ? true : v !== 'false'
  } catch {
    return true
  }
}

const statusBarExpanded = ref(readStatusBarExpanded())

function toggleStatusBar() {
  statusBarExpanded.value = !statusBarExpanded.value
  try {
    localStorage.setItem(STATUS_BAR_KEY, String(statusBarExpanded.value))
  } catch {
    // localStorage unavailable — non-fatal
  }
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

const leftCollapsed = ref(readPanelCollapsed('left', false))
const rightCollapsed = ref(readPanelCollapsed('right', false))

function setLeftCollapsed(v: boolean) {
  leftCollapsed.value = v
  writePanelCollapsed('left', v)
}

function setRightCollapsed(v: boolean) {
  rightCollapsed.value = v
  writePanelCollapsed('right', v)
}

watch(
  () => session.value?.status,
  (newStatus, oldStatus) => {
    const wasActive = oldStatus === 'running' || oldStatus === 'starting'
    const isNowActive = newStatus === 'running' || newStatus === 'starting'
    if (isNowActive && !wasActive) {
      turnStartedAt.value = Date.now()
      turnEndedAt.value = null
    } else if (!isNowActive && wasActive) {
      turnEndedAt.value = Date.now()
    }
  },
)

// Turn timing is reset in the selectedAgentLocalId watcher above.

const currentToolName = computed((): string | null => {
  const s = session.value
  if (!s || (s.status !== 'running' && s.status !== 'starting')) return null
  for (let i = s.events.length - 1; i >= 0; i--) {
    const evt = s.events[i]
    if (!evt) continue
    for (let j = evt.content.length - 1; j >= 0; j--) {
      const block = evt.content[j]
      if (block?.type === 'tool_use') return block.name
    }
  }
  return null
})

</script>

<template>
  <div v-if="session" class="h-full flex overflow-hidden">

    <!-- ── Left column: Agent Tree ─────────────────────────────────────────── -->
    <AgentTreePanel
      :collapsed="leftCollapsed"
      :root-session-id="props.liveId"
      :selected-id="selectedAgentLocalId"
      @collapse="setLeftCollapsed(true)"
      @expand="setLeftCollapsed(false)"
      @update:selected-id="selectedAgentLocalId = $event"
    />

    <!-- ── Center column: Chat ────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col min-w-0 overflow-hidden">

      <!-- Header -->
      <header class="border-b border-border px-3 py-2 shrink-0 flex items-center gap-2">
        <!-- Back to sessions list -->
        <button
          class="shrink-0 p-1 -ml-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Back to sessions"
          @click="router.push('/sessions')"
        >
          <ArrowLeft class="size-4" />
        </button>

        <!-- Session title -->
        <h1 class="text-sm font-medium truncate flex-1 min-w-0">
          {{ sessionTitle }}
        </h1>

        <!-- Pills + actions -->
        <div class="flex items-center gap-1.5 shrink-0">
          <!-- Project pill -->
          <span
            v-if="sessionProjectName"
            class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground"
          >
            {{ sessionProjectName }}
          </span>

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

      <!-- Verbosity filter toolbar — only for live sessions -->
      <div
        v-if="!isDraft"
        class="border-b border-border/50 px-4 py-1.5 shrink-0 flex items-center justify-between"
      >
        <button
          class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
          :title="statusBarExpanded ? 'Collapse status bar' : 'Expand status bar'"
          @click="toggleStatusBar"
        >
          <PanelBottomClose v-if="statusBarExpanded" class="size-3.5" />
          <PanelBottomOpen v-else class="size-3.5" />
        </button>
        <VerbosityFilter
          :model-value="verbosityState"
          :hidden-count="totalHiddenCount"
          @update:model-value="verbosityState = $event"
        />
      </div>

      <!-- Transcript scrollable area -->
      <div class="flex-1 relative min-h-0">
        <div ref="scroller" class="h-full overflow-y-auto" @scroll.passive="onScroll">
          <div v-if="session.error || promoteError" class="max-w-4xl mx-auto p-6">
            <div
              class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
            >
              {{ session.error || promoteError }}
            </div>
          </div>
          <DraftSessionPanel v-if="isDraft" :session="session" />
          <template v-else>
            <Transcript
              v-if="isResumed && historicalEvents.length"
              :events="historicalEvents"
              :verbosity-state="verbosityState"
              @show-all="onShowAll"
            />
            <div
              v-if="isResumed"
              class="flex items-center gap-3 px-6 py-2 text-xs text-muted-foreground select-none"
            >
              <span class="flex-1 border-t border-border" />
              <span>— Resumed —</span>
              <span class="flex-1 border-t border-border" />
            </div>
            <Transcript
              :events="session.events"
              :verbosity-state="verbosityState"
              @show-all="onShowAll"
            />
          </template>
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

      <!-- Processing status bar — outside scroll, always visible when expanded -->
      <SessionStatusBar
        v-if="!isDraft && statusBarExpanded"
        :status="session.status"
        :current-tool-name="currentToolName"
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
        :role-name="session.roleName"
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
        <template v-if="!isDraft" #toolbar-left>
          <div class="flex items-center gap-0.5">
            <Brain :size="13" class="text-muted-foreground shrink-0" />
            <select
              :value="session.effort ?? ''"
              :disabled="!canEditParams"
              class="text-[11px] text-muted-foreground bg-transparent border-none outline-none max-w-[60px]"
              :class="canEditParams ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'"
              @change="changeEffort($event)"
            >
              <option value="">default</option>
              <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">{{ e }}</option>
            </select>
          </div>
          <div class="flex items-center gap-0.5">
            <KeyRound :size="13" class="text-muted-foreground shrink-0" />
            <select
              :value="session.permissionMode ?? 'bypassPermissions'"
              :disabled="!canEditParams"
              class="text-[11px] text-muted-foreground bg-transparent border-none outline-none max-w-[80px]"
              :class="canEditParams ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'"
              @change="changePermissionMode(($event.target as HTMLSelectElement).value as PermissionMode)"
            >
              <option v-for="(label, val) in PERM_MODE_LABELS" :key="val" :value="val">
                {{ label }}
              </option>
            </select>
          </div>
          <select
            :value="session.model ?? MODEL_OPTIONS[0].value"
            :disabled="!canEditParams"
            class="text-[11px] text-muted-foreground font-mono bg-transparent border-none outline-none max-w-[72px]"
            :class="canEditParams ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'"
            @change="changeModel(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </template>
      </MessageInput>
    </div>

    <!-- ── Right column: Context ───────────────────────────────────────────── -->
    <ContextPanel
      :collapsed="rightCollapsed"
      :root-session-id="props.liveId"
      @collapse="setRightCollapsed(true)"
      @expand="setRightCollapsed(false)"
    />

  </div>

  <!-- Session not found -->
  <div v-else class="h-full flex items-center justify-center text-muted-foreground text-sm">
    Session not found.
  </div>
</template>
