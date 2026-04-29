<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Brain, Folder, KeyRound } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import Transcript from '@/components/transcript/Transcript.vue'
import MessageInput from '@/components/MessageInput.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { shortModel } from '@/lib/format'
import { ROLE_EFFORT_VALUES, type Attachment, type PermissionMode, type RoleEffort, type TranscriptEvent } from '@shared/ipc-contract'

const props = defineProps<{
  liveId: string
  enterToSend?: boolean
  sendModifier?: 'auto' | 'meta' | 'ctrl' | 'alt' | 'shift'
}>()

const store = useSessionStore()
const projectsStore = useProjectsStore()
const session = computed(() => store.getSession(props.liveId))

const sessionProjectName = computed(() => {
  const path = session.value?.projectPath ?? ''
  return (
    projectsStore.projects.find((p) => p.path === path)?.name ??
    path.split('/').filter(Boolean).pop() ??
    ''
  )
})

const isProjectMismatch = computed(
  () =>
    !!session.value &&
    !!projectsStore.focusedProject &&
    session.value.projectPath !== projectsStore.focusedProject.path,
)
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
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
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

watch(
  () => props.liveId,
  () => {
    isAtBottom.value = true
    hasNewMessages.value = false
    void scrollToBottom()
  },
  { immediate: true },
)

onMounted(async () => {
  const s = session.value
  if (s?.resumedFromSdkSessionId) {
    try {
      const transcript = await window.agentkeeper.sessions.read(
        s.projectPath,
        s.resumedFromSdkSessionId,
      )
      if (transcript) historicalEvents.value = transcript.events
    } catch {
      // non-fatal — live events still work
    }
  }
})

function onSend(text: string, attachments: Attachment[]) {
  void store.send(props.liveId, text, attachments)
}

async function onStop() {
  await store.interrupt(props.liveId)
}

async function onEnd() {
  await store.terminate(props.liveId)
}

function onDismiss() {
  store.dismiss(props.liveId)
}

const canSend = computed(
  () =>
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

const statusLabel = computed(() => {
  switch (session.value?.status) {
    case 'starting':
      return 'Starting…'
    case 'running':
      return 'Working…'
    case 'idle':
    case 'suspended':
      return 'Ready for input'
    case 'completed':
      return 'Completed'
    case 'terminated':
      return 'Terminated'
    case 'error':
      return 'Error'
    default:
      return ''
  }
})

const statusDotClass = computed(() => {
  switch (session.value?.status) {
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
</script>

<template>
  <div v-if="session" class="h-full flex flex-col">
    <header
      class="border-b border-border px-6 py-3 shrink-0 flex items-center gap-4"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <span class="inline-flex items-center gap-1.5 text-xs">
          <span class="size-1.5 rounded-full" :class="statusDotClass" />
          <span>{{ statusLabel }}</span>
        </span>
        <span
          v-if="session.branch"
          class="text-xs text-muted-foreground font-mono"
        >
          · ⎇ {{ session.branch }}
        </span>
        <span
          v-if="session.roleName"
          class="text-xs text-muted-foreground"
        >
          · {{ session.roleName }}
        </span>
        <span
          v-if="session.agencyName"
          class="text-xs text-muted-foreground"
        >
          · ◎ {{ session.agencyName }}
        </span>
        <span class="flex items-center gap-2 ml-auto">
          <span
            v-if="isProjectMismatch"
            class="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
            title="This session belongs to a different project than the one currently focused"
          >
            <Folder class="size-3 shrink-0" />
            {{ sessionProjectName }}
          </span>
          <span
            v-if="session.sdkSessionId"
            class="text-xs text-muted-foreground font-mono"
          >
            {{ session.sdkSessionId.slice(0, 8) }}
          </span>
        </span>
      </div>
      <div class="flex items-center gap-2">
        <Button
          v-if="!isTerminal"
          variant="ghost"
          size="sm"
          @click="onEnd"
        >
          End session
        </Button>
        <Button v-else variant="ghost" size="sm" @click="onDismiss">
          Dismiss
        </Button>
      </div>
    </header>

    <div class="flex-1 relative min-h-0">
      <div ref="scroller" class="h-full overflow-y-auto" @scroll.passive="onScroll">
        <div v-if="session.error" class="max-w-4xl mx-auto p-6">
          <div
            class="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {{ session.error }}
          </div>
        </div>
        <Transcript v-if="isResumed && historicalEvents.length" :events="historicalEvents" />
        <div
          v-if="isResumed"
          class="flex items-center gap-3 px-6 py-2 text-xs text-muted-foreground select-none"
        >
          <span class="flex-1 border-t border-border" />
          <span>— Resumed —</span>
          <span class="flex-1 border-t border-border" />
        </div>
        <Transcript :events="session.events" />
      </div>

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

    <MessageInput
      :disabled="isTerminal || session.status === 'starting'"
      :is-running="session.status === 'running'"
      :enter-to-send="props.enterToSend"
      :send-modifier="props.sendModifier"
      :project-path="session.projectPath"
      :role-name="session.roleName"
      :agency-name="session.agencyName"
      :placeholder="
        session.status === 'starting'
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
            <option v-for="(label, val) in PERM_MODE_LABELS" :key="val" :value="val">{{ label }}</option>
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
  <div v-else class="h-full flex items-center justify-center text-muted-foreground text-sm">
    Session not found.
  </div>
</template>
