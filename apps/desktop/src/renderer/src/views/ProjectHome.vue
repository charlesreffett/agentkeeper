<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import SessionsList from './SessionsList.vue'
import SessionDetail from './SessionDetail.vue'
import NewSessionModal from './NewSessionModal.vue'
import SettingsModal from './SettingsModal.vue'
import LiveSessionView from './LiveSessionView.vue'
import { useSessionStore } from '@/stores/sessions'
import type { LiveSession } from '@/stores/sessions'
import type {
  AppSettings,
  RecentProject,
  SessionSummary,
} from '@shared/ipc-contract'

const props = defineProps<{ project: RecentProject }>()
const emit = defineEmits<{ close: [] }>()

const sessionStore = useSessionStore()

const selectedHistoricalId = ref<string | null>(null)
const refreshTrigger = ref(0)

const newSessionOpen = ref(false)
const settingsOpen = ref(false)

const settings = ref<AppSettings>({ defaultModel: 'claude-sonnet-4-6' })

async function refreshConfig() {
  settings.value = await window.orchestral.settings.get()
}

function selectHistorical(session: SessionSummary) {
  selectedHistoricalId.value = session.id
  sessionStore.clearFocus()
}

function selectLive(session: LiveSession) {
  selectedHistoricalId.value = null
  sessionStore.focus(session.localId)
}

function refreshList() {
  refreshTrigger.value++
}

async function onNewSessionClick() {
  await refreshConfig()
  newSessionOpen.value = true
}

async function onStartSession(params: {
  initialPrompt: string
  model: string
}) {
  newSessionOpen.value = false
  selectedHistoricalId.value = null
  await sessionStore.start({
    projectPath: props.project.path,
    initialPrompt: params.initialPrompt,
    model: params.model,
  })
}

watch(
  () => props.project.path,
  () => {
    selectedHistoricalId.value = null
    sessionStore.clearFocus()
  },
)

onMounted(refreshConfig)
</script>

<template>
  <div class="h-full flex flex-col">
    <header
      class="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0"
    >
      <Button variant="ghost" size="sm" @click="emit('close')">← Back</Button>
      <div class="min-w-0 flex-1">
        <div class="font-medium text-sm truncate">{{ project.name }}</div>
        <div class="text-xs text-muted-foreground truncate font-mono">
          {{ project.path }}
        </div>
      </div>
      <Button size="sm" @click="onNewSessionClick">New session</Button>
      <Button variant="ghost" size="sm" @click="settingsOpen = true">
        Settings
      </Button>
      <Button variant="ghost" size="sm" @click="refreshList">Refresh</Button>
    </header>

    <div class="flex-1 flex min-h-0">
      <aside
        class="w-80 border-r border-border shrink-0 overflow-hidden flex flex-col bg-card/30"
      >
        <SessionsList
          :project-path="project.path"
          :selected-historical-id="selectedHistoricalId"
          :refresh-key="refreshTrigger"
          @select-historical="selectHistorical"
          @select-live="selectLive"
        />
      </aside>
      <main class="flex-1 min-w-0 overflow-hidden">
        <LiveSessionView
          v-if="sessionStore.currentLiveId"
          :live-id="sessionStore.currentLiveId"
        />
        <SessionDetail
          v-else-if="selectedHistoricalId"
          :project-path="project.path"
          :session-id="selectedHistoricalId"
        />
        <div
          v-else
          class="h-full flex items-center justify-center text-muted-foreground"
        >
          <div class="text-center space-y-1">
            <p class="text-sm">Select a session or start a new one.</p>
          </div>
        </div>
      </main>
    </div>

    <NewSessionModal
      :open="newSessionOpen"
      :project-path="project.path"
      :default-model="settings.defaultModel"
      @close="newSessionOpen = false"
      @start="onStartSession"
    />

    <SettingsModal
      :open="settingsOpen"
      @close="settingsOpen = false"
      @saved="refreshConfig"
    />
  </div>
</template>
