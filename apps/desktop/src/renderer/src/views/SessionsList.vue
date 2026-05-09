<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Session, SessionSummary } from '@shared/ipc-contract'
import { formatRelativeTime } from '@/lib/format'
import { useSessionStore } from '@/stores/sessions'
import type { LiveSession } from '@/stores/sessions'
import SessionListItem from '@/components/SessionListItem.vue'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const props = defineProps<{
  projectPath: string
  selectedHistoricalId: string | null
  refreshKey: number
}>()

const emit = defineEmits<{
  selectHistorical: [session: SessionSummary]
  selectLive: [session: LiveSession]
}>()

const store = useSessionStore()

const liveForProject = computed(() =>
  store.liveList.filter((s) => s.projectPath === props.projectPath),
)

const historical = ref<SessionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const persistedSessions = ref<Session[]>([])
const expiryDays = ref<number | null>(14)

const standaloneSessions = computed(() =>
  persistedSessions.value.filter((s) => !s.agencyInstanceId),
)

const agencyGroups = computed(() => {
  const groups = new Map<string, Session[]>()
  for (const s of persistedSessions.value) {
    if (!s.agencyInstanceId) continue
    let list = groups.get(s.agencyInstanceId)
    if (!list) { list = []; groups.set(s.agencyInstanceId, list) }
    list.push(s)
  }
  return groups
})

// ─── Confirmation dialog ─────────────────────────────────────────────────────

const confirmOpen = ref(false)
const confirmTitle = ref('')
const confirmDescription = ref('')
const pendingAction = ref<(() => Promise<void>) | null>(null)

function requestConfirm(title: string, description: string, action: () => Promise<void>) {
  confirmTitle.value = title
  confirmDescription.value = description
  pendingAction.value = action
  confirmOpen.value = true
}

async function executeConfirmed() {
  await pendingAction.value?.()
  pendingAction.value = null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysRemaining(lastActivityAt: number, days: number | null): number | null {
  if (days === null) return null
  const expiresAt = lastActivityAt + days * 86_400_000
  return Math.ceil((expiresAt - Date.now()) / 86_400_000)
}

async function load() {
  loading.value = true
  error.value = null
  try {
    historical.value = await window.agentkeeper.sessions.list(props.projectPath)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    historical.value = []
  } finally {
    loading.value = false
  }
}

async function loadPersisted() {
  try {
    const [sessions, settings] = await Promise.all([
      window.agentkeeper.sessions.listPersisted(props.projectPath),
      window.agentkeeper.settings.get(),
    ])
    persistedSessions.value = sessions
    expiryDays.value = settings.sessionExpiryDays
  } catch {
    // non-fatal
  }
}

watch(
  () => [props.projectPath, props.refreshKey],
  () => {
    void load()
    void loadPersisted()
  },
  { immediate: true },
)

// ─── Live ─────────────────────────────────────────────────────────────────────

function canDismissLive(s: LiveSession): boolean {
  return s.isDraft || s.status === 'terminated' || s.status === 'completed' || s.status === 'error'
}

function dismissLive(s: LiveSession) {
  store.dismiss(s.localId)
}

function liveFirstMessage(s: LiveSession): string {
  if (s.isDraft) return '(New session)'
  return s.initialPrompt.trim().split('\n')[0] ?? '(new session)'
}

function liveStatusLabel(s: LiveSession): string {
  if (s.isDraft) return 'Draft'
  switch (s.status) {
    case 'starting':
      return 'Starting'
    case 'running':
      return 'Working'
    case 'idle':
    case 'suspended':
      return 'Idle'
    case 'completed':
      return 'Completed'
    case 'terminated':
      return 'Terminated'
    case 'blocked':
      return 'Waiting'
    case 'error':
      return 'Error'
  }
}

function liveStatusDot(s: LiveSession): string {
  if (s.isDraft) return 'bg-muted-foreground/60'
  switch (s.status) {
    case 'running':
    case 'starting':
      return 'bg-emerald-500 animate-pulse'
    case 'idle':
    case 'suspended':
      return 'bg-amber-500'
    case 'completed':
    case 'terminated':
      return 'bg-muted-foreground'
    case 'blocked':
      return 'bg-amber-500'
    case 'error':
      return 'bg-destructive'
  }
}

// ─── Draft-message cross-reference ───────────────────────────────────────────
// Persisted sessions record both localId and sdkSessionId, letting us map a
// historical JSONL id (= sdkSessionId) back to the localId that keyed the
// localStorage draft entry.

const persistedBySdkId = computed(() => {
  const map = new Map<string, string>()
  for (const s of persistedSessions.value) {
    if (s.sdkSessionId) map.set(s.sdkSessionId, s.localId)
  }
  return map
})

function historicalDraftMessage(s: SessionSummary): string {
  const localId = persistedBySdkId.value.get(s.id)
  if (!localId) return ''
  return localStorage.getItem(`agentkeeper:draft:${localId}`) ?? ''
}

function persistedDraftMessage(s: Session): string {
  return localStorage.getItem(`agentkeeper:draft:${s.localId}`) ?? ''
}

// ─── Recent (historical JSONL) ────────────────────────────────────────────────

function deleteHistorical(s: SessionSummary) {
  requestConfirm(
    'Remove session?',
    `"${s.firstUserMessage || 'Session'}" will be permanently deleted.`,
    async () => {
      historical.value = historical.value.filter((x) => x.id !== s.id)
      await window.agentkeeper.sessions.deleteHistorical(props.projectPath, s.id)
    },
  )
}

function confirmRemoveAllHistorical() {
  const count = historical.value.length
  requestConfirm(
    'Remove all recent sessions?',
    `${count} session transcript${count !== 1 ? 's' : ''} will be permanently deleted.`,
    async () => {
      await window.agentkeeper.sessions.deleteAllHistorical(props.projectPath)
      historical.value = []
    },
  )
}

// ─── Previous (registry-persisted) ────────────────────────────────────────────

function openSession(s: Session) {
  const localId = store.openPersisted(s)
  emit('selectLive', store.getSession(localId)!)
}

function openAgency(agencyInstanceId: string) {
  const members = agencyGroups.value.get(agencyInstanceId) ?? []
  const localId = store.openPersistedAgency(members)
  const session = store.getSession(localId)
  if (session) emit('selectLive', session)
}

function confirmDismissSession(s: Session) {
  requestConfirm(
    'Remove session?',
    `"${s.initialPrompt.split('\n')[0] || 'Session'}" will be removed from the list.`,
    async () => {
      persistedSessions.value = persistedSessions.value.filter((x) => x.localId !== s.localId)
      await window.agentkeeper.sessions.deletePersisted(s.localId)
    },
  )
}

function confirmDismissAgency(agencyInstanceId: string) {
  const members = agencyGroups.value.get(agencyInstanceId) ?? []
  const entrySession = members.find((s) => !s.initialPrompt.startsWith('Agency "'))
  const name = entrySession?.initialPrompt.split('\n')[0] ?? 'Agency session'
  requestConfirm(
    'Remove agency session?',
    `"${name}" will be removed from the list.`,
    async () => {
      for (const s of members) {
        persistedSessions.value = persistedSessions.value.filter((x) => x.localId !== s.localId)
        await window.agentkeeper.sessions.deletePersisted(s.localId)
      }
    },
  )
}

function confirmRemoveAllPersisted() {
  const count = standaloneSessions.value.length + agencyGroups.value.size
  requestConfirm(
    'Remove all previous sessions?',
    `${count} session${count !== 1 ? 's' : ''} will be permanently removed.`,
    async () => {
      await window.agentkeeper.sessions.deleteAllPersisted(props.projectPath)
      persistedSessions.value = []
    },
  )
}

async function touchSession(localId: string) {
  await window.agentkeeper.sessions.touchPersisted(localId)
  await loadPersisted()
}

async function touchAgency(agencyInstanceId: string) {
  const members = agencyGroups.value.get(agencyInstanceId) ?? []
  for (const s of members) {
    await window.agentkeeper.sessions.touchPersisted(s.localId)
  }
  await loadPersisted()
}

// ─── Selection ────────────────────────────────────────────────────────────────

const selectionMode = ref(false)
const selectedHistorical = ref(new Set<string>())
const selectedPersisted = ref(new Set<string>())
const selectedAgencies = ref(new Set<string>())
const selectedLive = ref(new Set<string>())

const dismissableLive = computed(() => liveForProject.value.filter(canDismissLive))

const totalSelected = computed(
  () =>
    selectedHistorical.value.size +
    selectedPersisted.value.size +
    selectedAgencies.value.size +
    selectedLive.value.size,
)

const allHistoricalSelected = computed(
  () =>
    historical.value.length > 0 &&
    historical.value.every((s) => selectedHistorical.value.has(s.id)),
)

const allPersistedSelected = computed(
  () =>
    standaloneSessions.value.length > 0 &&
    standaloneSessions.value.every((s) => selectedPersisted.value.has(s.localId)) &&
    [...agencyGroups.value.keys()].every((id) => selectedAgencies.value.has(id)),
)

const allLiveSelected = computed(
  () =>
    dismissableLive.value.length > 0 &&
    dismissableLive.value.every((s) => selectedLive.value.has(s.localId)),
)

function toggleHistorical(id: string) {
  const s = new Set(selectedHistorical.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedHistorical.value = s
}

function togglePersisted(id: string) {
  const s = new Set(selectedPersisted.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedPersisted.value = s
}

function toggleAgency(id: string) {
  const s = new Set(selectedAgencies.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedAgencies.value = s
}

function toggleLive(id: string) {
  const s = new Set(selectedLive.value)
  s.has(id) ? s.delete(id) : s.add(id)
  selectedLive.value = s
}

function toggleAllHistorical() {
  if (allHistoricalSelected.value) selectedHistorical.value = new Set()
  else selectedHistorical.value = new Set(historical.value.map((s) => s.id))
}

function toggleAllPersisted() {
  if (allPersistedSelected.value) {
    selectedPersisted.value = new Set()
    selectedAgencies.value = new Set()
  } else {
    selectedPersisted.value = new Set(standaloneSessions.value.map((s) => s.localId))
    selectedAgencies.value = new Set(agencyGroups.value.keys())
  }
}

function toggleAllLive() {
  if (allLiveSelected.value) selectedLive.value = new Set()
  else selectedLive.value = new Set(dismissableLive.value.map((s) => s.localId))
}

function selectAll() {
  selectedHistorical.value = new Set(historical.value.map((s) => s.id))
  selectedPersisted.value = new Set(standaloneSessions.value.map((s) => s.localId))
  selectedAgencies.value = new Set(agencyGroups.value.keys())
  selectedLive.value = new Set(dismissableLive.value.map((s) => s.localId))
}

function exitSelectionMode() {
  selectionMode.value = false
  selectedHistorical.value = new Set()
  selectedPersisted.value = new Set()
  selectedAgencies.value = new Set()
  selectedLive.value = new Set()
}

async function deleteSelected() {
  const total = totalSelected.value
  requestConfirm(
    `Remove ${total} session${total !== 1 ? 's' : ''}?`,
    'Selected sessions will be permanently removed.',
    async () => {
      for (const id of selectedHistorical.value) {
        historical.value = historical.value.filter((s) => s.id !== id)
        await window.agentkeeper.sessions.deleteHistorical(props.projectPath, id)
      }
      for (const localId of selectedPersisted.value) {
        persistedSessions.value = persistedSessions.value.filter((s) => s.localId !== localId)
        await window.agentkeeper.sessions.deletePersisted(localId)
      }
      for (const instanceId of selectedAgencies.value) {
        const members = agencyGroups.value.get(instanceId) ?? []
        for (const s of members) {
          persistedSessions.value = persistedSessions.value.filter((x) => x.localId !== s.localId)
          await window.agentkeeper.sessions.deletePersisted(s.localId)
        }
      }
      for (const localId of selectedLive.value) {
        store.dismiss(localId)
      }
      exitSelectionMode()
    },
  )
}
</script>

<template>
  <div class="h-full flex flex-col">
    <!-- Shared confirmation dialog -->
    <AlertDialog v-model:open="confirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ confirmTitle }}</AlertDialogTitle>
          <AlertDialogDescription>{{ confirmDescription }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="executeConfirmed">Remove</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Selection toolbar -->
    <div
      v-if="selectionMode"
      class="shrink-0 px-4 py-2 border-b border-border bg-accent/30 flex items-center gap-3"
    >
      <span class="text-xs text-muted-foreground flex-1">{{ totalSelected }} selected</span>
      <button
        class="text-xs text-muted-foreground hover:text-foreground transition"
        @click="selectAll"
      >
        Select all
      </button>
      <button
        class="text-xs text-destructive hover:underline transition disabled:opacity-40"
        :disabled="totalSelected === 0"
        @click="deleteSelected"
      >
        Delete
      </button>
      <button
        class="text-xs text-muted-foreground hover:text-foreground transition"
        @click="exitSelectionMode"
      >
        Cancel
      </button>
    </div>

    <!-- Live -->
    <section v-if="liveForProject.length" class="shrink-0">
      <div class="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Live</h2>
        <div class="flex items-center gap-2">
          <input
            v-if="selectionMode && dismissableLive.length > 0"
            type="checkbox"
            :checked="allLiveSelected"
            class="size-3 accent-primary cursor-pointer shrink-0"
            @change="toggleAllLive"
          />
          <button
            v-if="!selectionMode"
            class="text-xs text-muted-foreground hover:text-foreground transition"
            @click="selectionMode = true"
          >
            Select
          </button>
          <span class="text-xs text-muted-foreground tabular-nums">{{ liveForProject.length }}</span>
        </div>
      </div>
      <ul>
        <SessionListItem
          v-for="s in liveForProject"
          :key="s.localId"
          :title="liveFirstMessage(s)"
          :status-dot="liveStatusDot(s)"
          :status-label="liveStatusLabel(s)"
          :draft-message="s.draftMessage"
          :message-count="s.isDraft ? null : s.events.length"
          :model="s.model"
          :branch="s.branch"
          :role-name="s.roleName"
          :agency-name="s.agencyName"
          :is-selected="store.currentLiveId === s.localId"
          :can-dismiss="canDismissLive(s)"
          :show-checkbox="selectionMode && canDismissLive(s)"
          :checked="selectedLive.has(s.localId)"
          @click="selectionMode ? undefined : emit('selectLive', s)"
          @dismiss="dismissLive(s)"
          @toggle="toggleLive(s.localId)"
        />
      </ul>
    </section>

    <!-- Recent (historical JSONL) -->
    <section class="flex-1 min-h-0 flex flex-col">
      <div
        class="px-4 py-2 border-b border-border flex items-center justify-between shrink-0"
      >
        <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Recent</h2>
        <div class="flex items-center gap-3">
          <input
            v-if="selectionMode && historical.length > 0"
            type="checkbox"
            :checked="allHistoricalSelected"
            class="size-3 accent-primary cursor-pointer shrink-0"
            @change="toggleAllHistorical"
          />
          <button
            v-if="!selectionMode && historical.length > 0"
            class="text-xs text-muted-foreground hover:text-foreground transition"
            @click="selectionMode = true"
          >
            Select
          </button>
          <button
            v-if="!selectionMode && historical.length > 0"
            class="text-xs text-muted-foreground hover:text-destructive transition"
            @click="confirmRemoveAllHistorical"
          >
            Remove all
          </button>
          <span v-if="!loading" class="text-xs text-muted-foreground tabular-nums">
            {{ historical.length }}
          </span>
        </div>
      </div>

      <div v-if="loading" class="p-4 text-sm text-muted-foreground">Loading…</div>
      <div v-else-if="error" class="p-4 text-sm text-destructive">{{ error }}</div>
      <div
        v-else-if="historical.length === 0"
        class="p-4 text-sm text-muted-foreground leading-relaxed"
      >
        No historical sessions.
      </div>

      <ul v-else class="overflow-y-auto">
        <SessionListItem
          v-for="s in historical"
          :key="s.id"
          :title="s.firstUserMessage || '(no user message)'"
          status-dot="bg-muted-foreground/40"
          status-label="Inactive"
          :draft-message="historicalDraftMessage(s)"
          :message-count="s.messageCount"
          :model="s.model"
          :branch="s.gitBranch"
          :last-activity-at="s.lastActivityAt"
          :is-selected="selectedHistoricalId === s.id"
          :show-checkbox="selectionMode"
          :checked="selectedHistorical.has(s.id)"
          can-dismiss
          @click="selectionMode ? undefined : emit('selectHistorical', s)"
          @dismiss="deleteHistorical(s)"
          @toggle="toggleHistorical(s.id)"
        />
      </ul>
    </section>

    <!-- Previous (registry-persisted, resumable) -->
    <section
      v-if="standaloneSessions.length || agencyGroups.size"
      class="shrink-0 border-t border-border"
    >
      <div class="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">Previous</h2>
        <div class="flex items-center gap-2">
          <input
            v-if="selectionMode"
            type="checkbox"
            :checked="allPersistedSelected"
            class="size-3 accent-primary cursor-pointer shrink-0"
            @change="toggleAllPersisted"
          />
          <button
            v-if="!selectionMode"
            class="text-xs text-muted-foreground hover:text-foreground transition"
            @click="selectionMode = true"
          >
            Select
          </button>
          <button
            v-if="!selectionMode"
            class="text-xs text-muted-foreground hover:text-destructive transition"
            @click="confirmRemoveAllPersisted"
          >
            Remove all
          </button>
        </div>
      </div>
      <ul class="overflow-y-auto max-h-64">
        <!-- Standalone sessions -->
        <SessionListItem
          v-for="s in standaloneSessions"
          :key="s.localId"
          :title="s.initialPrompt.split('\n')[0] || '(no prompt)'"
          status-dot="bg-muted-foreground/40"
          status-label="Inactive"
          :draft-message="persistedDraftMessage(s)"
          :model="s.model"
          :branch="s.branch"
          :role-name="s.roleName"
          :last-activity-at="s.lastActivityAt"
          :show-checkbox="selectionMode"
          :checked="selectedPersisted.has(s.localId)"
          can-dismiss
          @click="selectionMode ? undefined : openSession(s)"
          @dismiss="confirmDismissSession(s)"
          @toggle="togglePersisted(s.localId)"
        >
          <template #actions>
            <button
              v-if="
                daysRemaining(s.lastActivityAt, expiryDays) !== null &&
                daysRemaining(s.lastActivityAt, expiryDays)! <= 3
              "
              class="text-xs px-1.5 py-1 rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition shrink-0"
              title="Reset expiry"
              @click.stop="touchSession(s.localId)"
            >
              Keep
            </button>
          </template>
          <div
            v-if="
              daysRemaining(s.lastActivityAt, expiryDays) !== null &&
              daysRemaining(s.lastActivityAt, expiryDays)! <= 3
            "
            class="mt-1 pl-3.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
          >
            Expires in {{ daysRemaining(s.lastActivityAt, expiryDays) }} day{{
              daysRemaining(s.lastActivityAt, expiryDays) === 1 ? '' : 's'
            }}
          </div>
        </SessionListItem>

        <!-- Agencies -->
        <template v-for="[instanceId, members] in agencyGroups" :key="instanceId">
          <SessionListItem
            title-prefix="◎"
            :title="members.find(s => !s.initialPrompt.startsWith('Agency &quot;'))?.initialPrompt.split('\n')[0] ?? members[0]?.agencyName ?? 'Agency session'"
            status-dot="bg-muted-foreground/40"
            status-label="Inactive"
            :branch="members.find(s => !s.initialPrompt.startsWith('Agency &quot;'))?.branch ?? members[0]?.branch ?? null"
            :last-activity-at="Math.max(...members.map(s => s.lastActivityAt))"
            :show-checkbox="selectionMode"
            :checked="selectedAgencies.has(instanceId)"
            can-dismiss
            @click="selectionMode ? undefined : openAgency(instanceId)"
            @dismiss="confirmDismissAgency(instanceId)"
            @toggle="toggleAgency(instanceId)"
          >
            <template #actions>
              <button
                v-if="
                  daysRemaining(Math.max(...members.map(s => s.lastActivityAt)), expiryDays) !== null &&
                  daysRemaining(Math.max(...members.map(s => s.lastActivityAt)), expiryDays)! <= 3
                "
                class="text-xs px-1.5 py-1 rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition shrink-0"
                title="Reset expiry"
                @click.stop="touchAgency(instanceId)"
              >
                Keep
              </button>
            </template>
            <div
              v-if="
                daysRemaining(Math.max(...members.map(s => s.lastActivityAt)), expiryDays) !== null &&
                daysRemaining(Math.max(...members.map(s => s.lastActivityAt)), expiryDays)! <= 3
              "
              class="mt-1 pl-3.5 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
            >
              Expires in {{ daysRemaining(Math.max(...members.map(s => s.lastActivityAt)), expiryDays) }} day{{
                daysRemaining(Math.max(...members.map(s => s.lastActivityAt)), expiryDays) === 1 ? '' : 's'
              }}
            </div>
          </SessionListItem>
        </template>
      </ul>
    </section>
  </div>
</template>
