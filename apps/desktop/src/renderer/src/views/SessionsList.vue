<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgencyInstance, PersistedAgency, PersistedSession, SessionSummary } from '@shared/ipc-contract'
import { formatRelativeTime, shortModel } from '@/lib/format'
import { useSessionStore } from '@/stores/sessions'
import type { LiveSession } from '@/stores/sessions'
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
  agencyResumed: [instance: AgencyInstance, entrySessionId: string | null]
}>()

const store = useSessionStore()

const liveForProject = computed(() =>
  store.liveList.filter((s) => s.projectPath === props.projectPath),
)

const historical = ref<SessionSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const persistedSessions = ref<PersistedSession[]>([])
const persistedAgencies = ref<PersistedAgency[]>([])
const resumingId = ref<string | null>(null)
const expiryDays = ref<number | null>(14)

const standalonePersistedSessions = computed(() =>
  persistedSessions.value.filter((s) => !s.agencyInstanceId),
)

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
    const [sessions, agencies, settings] = await Promise.all([
      window.agentkeeper.sessions.listPersisted(props.projectPath),
      window.agentkeeper.agencies.listPersisted(props.projectPath),
      window.agentkeeper.settings.get(),
    ])
    persistedSessions.value = sessions
    persistedAgencies.value = agencies
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
  return s.status === 'terminated' || s.status === 'completed' || s.status === 'error'
}

function dismissLive(s: LiveSession) {
  store.dismiss(s.localId)
}

function liveFirstMessage(s: LiveSession): string {
  return s.initialPrompt.trim().split('\n')[0] ?? '(new session)'
}

function liveStatusLabel(s: LiveSession): string {
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
    case 'error':
      return 'Error'
  }
}

function liveStatusDot(s: LiveSession): string {
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
    case 'error':
      return 'bg-destructive'
  }
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

async function resumeSession(persisted: PersistedSession) {
  if (resumingId.value) return
  resumingId.value = persisted.localId
  try {
    const newId = await store.resume(persisted)
    store.focus(newId)
    emit('selectLive', store.getSession(newId)!)
  } catch {
    // error visible via session status
  } finally {
    resumingId.value = null
  }
}

async function resumeAgency(persisted: PersistedAgency) {
  if (resumingId.value) return
  resumingId.value = persisted.instanceId
  try {
    const instance = await window.agentkeeper.agencies.resume(persisted.instanceId)
    for (const s of instance.sessions) {
      const persistedRole = persistedSessions.value.find(
        (p) => p.agencyInstanceId === persisted.instanceId && p.roleId === s.roleId,
      )
      store.registerExternal({
        localId: s.localId,
        projectPath: persisted.projectPath,
        worktreePath: persisted.worktreePath,
        branch: persisted.branch,
        roleName: s.roleName,
        agencyInstanceId: instance.instanceId,
        agencyName: instance.agencyName,
        initialPrompt: persistedRole?.initialPrompt ?? '',
        model: persistedRole?.model ?? null,
      })
    }
    const entrySession = instance.sessions.find((s) => s.isEntryPoint)
    if (entrySession) store.focus(entrySession.localId)
    emit('agencyResumed', instance, entrySession?.localId ?? null)
  } catch {
    // error surfaced via session status
  } finally {
    resumingId.value = null
  }
}

function confirmDismissSession(s: PersistedSession) {
  requestConfirm(
    'Remove session?',
    `"${s.initialPrompt.split('\n')[0] || 'Session'}" will be removed from the list.`,
    async () => {
      persistedSessions.value = persistedSessions.value.filter((x) => x.localId !== s.localId)
      await window.agentkeeper.sessions.deletePersisted(s.localId)
    },
  )
}

function confirmDismissAgency(a: PersistedAgency) {
  requestConfirm(
    'Remove agency session?',
    `"${a.agencyName}" will be removed from the list.`,
    async () => {
      persistedAgencies.value = persistedAgencies.value.filter((x) => x.instanceId !== a.instanceId)
      await window.agentkeeper.agencies.deletePersisted(a.instanceId)
    },
  )
}

function confirmRemoveAllPersisted() {
  const count = standalonePersistedSessions.value.length + persistedAgencies.value.length
  requestConfirm(
    'Remove all previous sessions?',
    `${count} session${count !== 1 ? 's' : ''} will be permanently removed.`,
    async () => {
      await window.agentkeeper.sessions.deleteAllPersisted(props.projectPath)
      persistedSessions.value = []
      persistedAgencies.value = []
    },
  )
}

async function touchSession(localId: string) {
  await window.agentkeeper.sessions.touchPersisted(localId)
  await loadPersisted()
}

async function touchAgency(instanceId: string) {
  await window.agentkeeper.agencies.touchPersisted(instanceId)
  await loadPersisted()
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

    <!-- Live -->
    <section v-if="liveForProject.length" class="shrink-0">
      <div
        class="px-4 py-2 border-b border-border flex items-center justify-between"
      >
        <h2
          class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          Live
        </h2>
        <span class="text-xs text-muted-foreground tabular-nums">
          {{ liveForProject.length }}
        </span>
      </div>
      <ul>
        <li
          v-for="s in liveForProject"
          :key="s.localId"
          class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
          :class="store.currentLiveId === s.localId ? 'bg-accent' : ''"
          @click="emit('selectLive', s)"
        >
          <div class="flex items-center gap-2">
            <span class="size-1.5 rounded-full shrink-0" :class="liveStatusDot(s)" />
            <div class="text-sm font-medium truncate leading-snug flex-1 min-w-0">
              {{ liveFirstMessage(s) }}
            </div>
            <button
              v-if="canDismissLive(s)"
              class="text-xs px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition shrink-0"
              title="Dismiss"
              @click.stop="dismissLive(s)"
            >
              ×
            </button>
          </div>
          <div
            class="mt-1 pl-3.5 flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
          >
            <span>{{ liveStatusLabel(s) }}</span>
            <span>·</span>
            <span>{{ s.events.length }} msg</span>
            <span v-if="shortModel(s.model)">·</span>
            <span v-if="shortModel(s.model)" class="font-mono">
              {{ shortModel(s.model) }}
            </span>
          </div>
          <div
            v-if="s.branch || s.roleName || s.agencyName"
            class="mt-1 pl-3.5 text-[10px] text-muted-foreground truncate flex gap-2 flex-wrap"
          >
            <span v-if="s.agencyName" class="text-foreground/80">
              ◎ {{ s.agencyName }}
            </span>
            <span v-if="s.branch" class="font-mono">⎇ {{ s.branch }}</span>
            <span v-if="s.roleName">{{ s.roleName }}</span>
          </div>
        </li>
      </ul>
    </section>

    <!-- Recent (historical JSONL) -->
    <section class="flex-1 min-h-0 flex flex-col">
      <div
        class="px-4 py-2 border-b border-border flex items-center justify-between shrink-0"
      >
        <h2
          class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          Recent
        </h2>
        <div class="flex items-center gap-3">
          <button
            v-if="historical.length > 0"
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

      <div v-if="loading" class="p-4 text-sm text-muted-foreground">
        Loading…
      </div>

      <div v-else-if="error" class="p-4 text-sm text-destructive">
        {{ error }}
      </div>

      <div
        v-else-if="historical.length === 0"
        class="p-4 text-sm text-muted-foreground leading-relaxed"
      >
        No historical sessions.
      </div>

      <ul v-else class="overflow-y-auto">
        <li
          v-for="s in historical"
          :key="s.id"
          class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50 group"
          :class="selectedHistoricalId === s.id ? 'bg-accent' : ''"
          @click="emit('selectHistorical', s)"
        >
          <div class="flex items-start gap-2">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate leading-snug">
                {{ s.firstUserMessage || '(no user message)' }}
              </div>
              <div
                class="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums"
              >
                <span>{{ formatRelativeTime(s.lastActivityAt) }}</span>
                <span>·</span>
                <span>{{ s.messageCount }} msg</span>
                <span v-if="shortModel(s.model)">·</span>
                <span v-if="shortModel(s.model)" class="font-mono">
                  {{ shortModel(s.model) }}
                </span>
              </div>
            </div>
            <button
              class="text-xs px-1.5 py-1 rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition shrink-0 opacity-0 group-hover:opacity-100"
              title="Remove"
              @click.stop="deleteHistorical(s)"
            >
              ×
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Previous (registry-persisted, resumable) -->
    <section
      v-if="standalonePersistedSessions.length || persistedAgencies.length"
      class="shrink-0 border-t border-border"
    >
      <div class="px-4 py-2 border-b border-border flex items-center justify-between">
        <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Previous
        </h2>
        <button
          class="text-xs text-muted-foreground hover:text-destructive transition"
          @click="confirmRemoveAllPersisted"
        >
          Remove all
        </button>
      </div>
      <ul class="overflow-y-auto max-h-64">
        <!-- Standalone sessions -->
        <li
          v-for="s in standalonePersistedSessions"
          :key="s.localId"
          class="border-b border-border/50 px-4 py-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate leading-snug">
                {{ s.initialPrompt.split('\n')[0] || '(no prompt)' }}
              </div>
              <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums flex-wrap">
                <span>{{ formatRelativeTime(s.lastActivityAt) }}</span>
                <span v-if="s.roleName">· {{ s.roleName }}</span>
                <span v-if="shortModel(s.model)">· <span class="font-mono">{{ shortModel(s.model) }}</span></span>
              </div>
              <div
                v-if="daysRemaining(s.lastActivityAt, expiryDays) !== null && daysRemaining(s.lastActivityAt, expiryDays)! <= 3"
                class="mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
              >
                Expires in {{ daysRemaining(s.lastActivityAt, expiryDays) }} day{{ daysRemaining(s.lastActivityAt, expiryDays) === 1 ? '' : 's' }}
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                v-if="daysRemaining(s.lastActivityAt, expiryDays) !== null && daysRemaining(s.lastActivityAt, expiryDays)! <= 3"
                class="text-xs px-1.5 py-1 rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                title="Reset expiry"
                @click.stop="touchSession(s.localId)"
              >
                Keep
              </button>
              <button
                class="text-xs px-2 py-1 rounded border border-border hover:bg-accent transition disabled:opacity-50"
                :disabled="resumingId === s.localId"
                @click="resumeSession(s)"
              >
                {{ resumingId === s.localId ? '…' : 'Resume' }}
              </button>
              <button
                class="text-xs px-1.5 py-1 rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition"
                title="Remove"
                @click.stop="confirmDismissSession(s)"
              >
                ×
              </button>
            </div>
          </div>
        </li>
        <!-- Agencies -->
        <li
          v-for="a in persistedAgencies"
          :key="a.instanceId"
          class="border-b border-border/50 px-4 py-3"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate leading-snug flex items-center gap-1.5">
                <span class="text-muted-foreground">◎</span>
                {{ a.agencyName }}
              </div>
              <div class="mt-1 flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
                <span>{{ formatRelativeTime(a.lastActivityAt) }}</span>
                <span v-if="a.branch">· <span class="font-mono">⎇ {{ a.branch }}</span></span>
              </div>
              <div
                v-if="daysRemaining(a.lastActivityAt, expiryDays) !== null && daysRemaining(a.lastActivityAt, expiryDays)! <= 3"
                class="mt-1 text-[10px] text-amber-600 dark:text-amber-400 font-medium"
              >
                Expires in {{ daysRemaining(a.lastActivityAt, expiryDays) }} day{{ daysRemaining(a.lastActivityAt, expiryDays) === 1 ? '' : 's' }}
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button
                v-if="daysRemaining(a.lastActivityAt, expiryDays) !== null && daysRemaining(a.lastActivityAt, expiryDays)! <= 3"
                class="text-xs px-1.5 py-1 rounded border border-amber-400/50 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition"
                title="Reset expiry"
                @click.stop="touchAgency(a.instanceId)"
              >
                Keep
              </button>
              <button
                class="text-xs px-2 py-1 rounded border border-border hover:bg-accent transition disabled:opacity-50"
                :disabled="resumingId === a.instanceId"
                @click="resumeAgency(a)"
              >
                {{ resumingId === a.instanceId ? '…' : 'Resume' }}
              </button>
              <button
                class="text-xs px-1.5 py-1 rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive hover:border-destructive/40 transition"
                title="Remove"
                @click.stop="confirmDismissAgency(a)"
              >
                ×
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>
