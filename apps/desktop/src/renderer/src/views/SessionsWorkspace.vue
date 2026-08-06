<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import LiveSessionView from '@/views/LiveSessionView.vue'
import SessionsSidebar from '@/components/session/SessionsSidebar.vue'
import SessionsWelcome from '@/views/SessionsWelcome.vue'
import { useSessionStore } from '@/stores/sessions'
import { useUnifiedSessions } from '@/composables/useUnifiedSessions'
import { type AppSettings } from '@shared/ipc-contract'

const route = useRoute()
const router = useRouter()
const sessionStore = useSessionStore()
const { invalidateAll } = useUnifiedSessions()

const id = computed(() => (route.params.id as string) ?? '')

// ── Rail collapse (persisted via localStorage) ──────────────────────────────

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

function setLeftCollapsed(v: boolean) {
  leftCollapsed.value = v
  writePanelCollapsed('left', v)
}

// ── Session loading ──────────────────────────────────────────────────────────

const settings = ref<AppSettings>({
  defaultModel: 'default',
  defaultEffort: 'medium',
  defaultUseWorktree: false,
  enterToSend: false,
  sendModifier: 'auto',
  sessionExpiryEnabled: false,
  sessionExpiryDays: 14,
  theme: 'dark',
  notifications: 'all',
  notificationSound: 'chime',
  mcpServers: [],
})

const loading = ref(false)

const sessionExists = computed(() => !!id.value && !!sessionStore.getSession(id.value))

async function ensureSession(localId: string) {
  if (!localId || sessionStore.getSession(localId)) return
  loading.value = true
  try {
    const result = await window.agentkeeper.sessions.getByLocalId(localId)
    if (result) sessionStore.openPersisted(result)
  } finally {
    loading.value = false
  }
}

// No session selected → default to a draft for the current project. The draft
// is created/focused in-memory and we land on it instead of a landing page.
const preparingDraft = ref(false)

async function focusDraftForCurrentProject() {
  if (id.value) return
  preparingDraft.value = true
  try {
    // Context is a per-session choice made in the compose header — default a
    // fresh draft to no project (it gets one from the picker when started).
    const settingsNow = await window.agentkeeper.settings.get()
    const localId = sessionStore.createOrFocusDraft({
      projectPath: null,
      defaultModel: settingsNow.defaultModel,
      defaultEffort: settingsNow.defaultEffort,
      defaultUseWorktree: settingsNow.defaultUseWorktree,
    })
    void router.replace(`/sessions/${localId}`)
  } finally {
    preparingDraft.value = false
  }
}

watch(id, (v) => {
  if (v) void ensureSession(v)
  else void focusDraftForCurrentProject()
}, { immediate: true })

onMounted(async () => {
  settings.value = await window.agentkeeper.settings.get()
})

// When the active session disappears (deleted/terminated elsewhere), fall back
// to the no-selection welcome state instead of a dead "not found" screen.
const notFound = computed(() => !!id.value && !sessionExists.value && !loading.value)

watch(notFound, (m) => {
  if (m) void router.replace('/sessions')
})

// Sessions created/deleted elsewhere (mobile, agency orchestrator) aren't
// reflected in any query cache — refetch so the rail stays in sync.
let unsubSessionCreated: (() => void) | null = null
let unsubSessionDeleted: (() => void) | null = null

onMounted(() => {
  unsubSessionCreated = window.agentkeeper.sessions.onCreated(() => invalidateAll())
  unsubSessionDeleted = window.agentkeeper.sessions.onDeleted(() => invalidateAll())
})

onUnmounted(() => {
  unsubSessionCreated?.(); unsubSessionCreated = null
  unsubSessionDeleted?.(); unsubSessionDeleted = null
})
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <!-- ── Left column: Sessions rail ────────────────────────────────────── -->
    <SessionsSidebar
      :collapsed="leftCollapsed"
      :active-id="id"
      @collapse="setLeftCollapsed(true)"
      @expand="setLeftCollapsed(false)"
    />

    <!-- ── Center column ─────────────────────────────────────────────────── -->
    <div class="flex-1 min-w-0 overflow-hidden">
      <LiveSessionView
        v-if="sessionExists"
        :live-id="id"
        :enter-to-send="settings.enterToSend"
        :send-modifier="settings.sendModifier"
      />
      <div
        v-else-if="loading"
        class="h-full flex items-center justify-center text-muted-foreground text-sm"
      >
        Loading session…
      </div>
      <div
        v-else-if="preparingDraft"
        class="h-full flex items-center justify-center text-muted-foreground text-sm"
      >
        Preparing draft…
      </div>
      <SessionsWelcome v-else-if="!id" />
      <div
        v-else
        class="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground text-sm"
      >
        <p>Session not found.</p>
        <Button variant="ghost" size="sm" @click="router.push('/sessions')">
          Back to Sessions
        </Button>
      </div>
    </div>
  </div>
</template>
