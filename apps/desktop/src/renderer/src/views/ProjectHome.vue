<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import SessionsList from './SessionsList.vue'
import SessionDetail from './SessionDetail.vue'
import NewSessionModal from './NewSessionModal.vue'
import SettingsModal from './SettingsModal.vue'
import LiveSessionView from './LiveSessionView.vue'
import type {
  AppSettings,
  RecentProject,
  SessionSummary,
  StartSessionParams,
} from '@shared/ipc-contract'

const props = defineProps<{ project: RecentProject }>()
const emit = defineEmits<{ close: [] }>()

const selectedSessionId = ref<string | null>(null)
const refreshTrigger = ref(0)

const newSessionOpen = ref(false)
const settingsOpen = ref(false)
const liveStartParams = ref<StartSessionParams | null>(null)

const settings = ref<AppSettings>({ defaultModel: 'claude-sonnet-4-6' })
const hasApiKey = ref(false)

async function refreshConfig() {
  settings.value = await window.orchestral.settings.get()
  hasApiKey.value = await window.orchestral.secrets.has('anthropicApiKey')
}

function selectSession(session: SessionSummary) {
  selectedSessionId.value = session.id
}

function refreshList() {
  refreshTrigger.value++
}

async function onNewSessionClick() {
  await refreshConfig()
  newSessionOpen.value = true
}

function onStartSession(params: { initialPrompt: string; model: string }) {
  newSessionOpen.value = false
  liveStartParams.value = {
    projectPath: props.project.path,
    initialPrompt: params.initialPrompt,
    model: params.model,
  }
}

function onLiveClose() {
  liveStartParams.value = null
  refreshList()
}

watch(
  () => props.project.path,
  () => {
    selectedSessionId.value = null
    liveStartParams.value = null
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
      <Button
        variant="ghost"
        size="sm"
        :aria-label="'Settings'"
        @click="settingsOpen = true"
      >
        Settings
      </Button>
      <Button variant="ghost" size="sm" @click="refreshList">Refresh</Button>
    </header>

    <div v-if="liveStartParams" class="flex-1 min-h-0">
      <LiveSessionView
        :start-params="liveStartParams"
        @close="onLiveClose"
      />
    </div>

    <div v-else class="flex-1 flex min-h-0">
      <aside
        class="w-80 border-r border-border shrink-0 overflow-y-auto bg-card/30"
      >
        <SessionsList
          :project-path="project.path"
          :selected-id="selectedSessionId"
          :refresh-key="refreshTrigger"
          @select="selectSession"
        />
      </aside>
      <main class="flex-1 min-w-0 overflow-y-auto">
        <SessionDetail
          :project-path="project.path"
          :session-id="selectedSessionId"
        />
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
