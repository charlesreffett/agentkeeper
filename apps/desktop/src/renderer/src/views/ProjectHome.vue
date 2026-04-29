<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import SessionsList from './SessionsList.vue'
import SessionDetail from './SessionDetail.vue'
import NewSessionModal from './NewSessionModal.vue'
import LiveSessionView from './LiveSessionView.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectStore } from '@/stores/project'
import type { LiveSession } from '@/stores/sessions'
import type {
  AppSettings,
  PermissionMode,
  Role,
  RoleEffort,
  SessionSummary,
} from '@shared/ipc-contract'

const router = useRouter()
const sessionStore = useSessionStore()
const projectStore = useProjectStore()

// Invariant: only reachable after setProject(); assert non-null for template ergonomics.
const project = computed(() => projectStore.currentProject!)

const selectedHistoricalId = ref<string | null>(null)
const refreshTrigger = ref(0)

const newSessionOpen = ref(false)

const settings = ref<AppSettings>({
  defaultModel: 'claude-sonnet-4-6',
  defaultEffort: 'medium',
  defaultUseWorktree: false,
  enterToSend: false,
  sendModifier: 'auto',
  sessionExpiryDays: 14,
  theme: 'dark',
})

async function refreshConfig() {
  settings.value = await window.agentkeeper.settings.get()
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

const startError = ref<string | null>(null)

async function onStartSession(params: {
  projectPath: string
  initialPrompt: string
  model: string
  effort: RoleEffort
  permissionMode: PermissionMode
  useWorktree: boolean
  branch: string
  role: Role | null
}) {
  newSessionOpen.value = false
  selectedHistoricalId.value = null
  startError.value = null

  let worktreePath: string | undefined
  let branch: string | undefined
  if (params.useWorktree && params.branch) {
    try {
      const wt = await window.agentkeeper.worktrees.create(
        params.projectPath,
        params.branch,
      )
      worktreePath = wt.path
      branch = wt.branch
    } catch (err) {
      startError.value =
        err instanceof Error ? err.message : String(err)
      return
    }
  }

  // `effort` from the dialog already resolved the precedence:
  //   manual override > role.effort > settings.defaultEffort
  await sessionStore.start({
    projectPath: params.projectPath,
    ...(worktreePath ? { worktreePath } : {}),
    ...(branch ? { branch } : {}),
    ...(params.role?.name ? { roleName: params.role.name } : {}),
    ...(params.role?.systemPrompt
      ? { systemPromptAppend: params.role.systemPrompt }
      : {}),
    ...(params.role?.allowedTools && params.role.allowedTools.length
      ? { allowedTools: params.role.allowedTools }
      : {}),
    effort: params.effort,
    permissionMode: params.permissionMode,
    initialPrompt: params.initialPrompt,
    model: params.model,
  })
}

async function onResumeHistorical(sdkSessionId: string, projectPath: string, text: string) {
  selectedHistoricalId.value = null
  startError.value = null
  await sessionStore.resumeFromHistory({
    sdkSessionId,
    projectPath,
    firstMessage: text,
    model: settings.value.defaultModel,
    effort: settings.value.defaultEffort,
  })
}

function closeProject() {
  projectStore.clearProject()
  router.push('/')
}

watch(
  () => projectStore.currentProject?.path,
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
      <Button variant="ghost" size="sm" @click="closeProject">← Back</Button>
      <div class="min-w-0 flex-1">
        <div class="font-medium text-sm truncate">{{ project.name }}</div>
        <div class="text-xs text-muted-foreground truncate font-mono">
          {{ project.path }}
        </div>
      </div>
      <Button size="sm" @click="onNewSessionClick">New session</Button>
      <Button variant="ghost" size="sm" @click="refreshList">Refresh</Button>
    </header>

    <div
      v-if="startError"
      class="border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-xs text-destructive flex items-center gap-2"
    >
      <span class="flex-1 truncate">{{ startError }}</span>
      <button
        class="hover:underline"
        @click="startError = null"
      >
        Dismiss
      </button>
    </div>

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
          @agency-resumed="
            (_instance, entrySessionId) => {
              if (entrySessionId) {
                selectedHistoricalId = null
                sessionStore.focus(entrySessionId)
              }
            }
          "
        />
      </aside>
      <main class="flex-1 min-w-0 overflow-hidden">
        <LiveSessionView
          v-if="sessionStore.currentLiveId"
          :live-id="sessionStore.currentLiveId"
          :enter-to-send="settings.enterToSend"
          :send-modifier="settings.sendModifier"
        />
        <SessionDetail
          v-else-if="selectedHistoricalId"
          :project-path="project.path"
          :session-id="selectedHistoricalId"
          @resume-and-send="onResumeHistorical"
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
      :default-effort="settings.defaultEffort"
      :default-use-worktree="settings.defaultUseWorktree"
      @close="newSessionOpen = false"
      @start="onStartSession"
    />

  </div>
</template>
