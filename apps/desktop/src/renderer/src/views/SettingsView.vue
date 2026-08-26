<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { ROLE_EFFORT_VALUES, type AppSettings, type AppUpdateState } from '@shared/ipc-contract'
import { NOTIFICATION_SOUND_VALUES, NOTIFICATION_SOUND_LABELS, playNotificationSound } from '@/lib/notificationSound'
import { useLayoutStore } from '@/stores/layout'
import { usePageScope } from '@/composables/usePageScope'
import ScopeBar from '@/components/ScopeBar.vue'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { queryKeys } from '@/lib/queryKeys'
import { pluginSettingsPanels } from '@/lib/pluginSettingsPanels'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { useHarnessList, useActiveHarness, useHarnessAuth, useSetActiveHarness } from '@/composables/useHarness'
import ExecutionTargetPicker from '@/components/ExecutionTargetPicker.vue'
import PageHeader from '@/components/PageHeader.vue'

const route = useRoute()
const router = useRouter()
const queryClient = useQueryClient()
const layoutStore = useLayoutStore()
// Settings are global except the danger-zone project reset, which targets the
// scoped project. Global/All → no project selected; a project scope enables it.
const { scope, options, setScope, pickAndAdd, label, color, isProject, currentProject } =
  usePageScope('settings', { includeGlobal: true })
const {
  settings: storedSettings,
  isLoading,
  invalidateAll,
} = useSettingsQuery()
const projectPath = computed(() => (isProject.value ? currentProject.value?.path ?? '' : ''))

// ─── Tab routing ──────────────────────────────────────────────────────────────

const tabs = computed(() => [
  { id: 'general', label: 'General' },
  ...pluginSettingsPanels.map((p) => ({ id: p.id, label: p.label })),
])

const activeTab = ref((route.query.tab as string | undefined) ?? 'general')

watch(
  () => route.query.tab,
  (tab) => { activeTab.value = (tab as string | undefined) ?? 'general' },
)

function selectTab(id: string) {
  activeTab.value = id
  void router.replace({ query: id === 'general' ? {} : { tab: id } })
}

const activePluginPanel = computed(() =>
  pluginSettingsPanels.find((p) => p.id === activeTab.value),
)

// ─── General tab: app settings ────────────────────────────────────────────────

const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

const settings = ref<AppSettings | null>(null)
const baseline = ref<AppSettings | null>(null)
const saving = ref(false)
const appUpdate = ref<AppUpdateState | null>(null)
let removeAppUpdateListener: (() => void) | null = null

onMounted(async () => {
  appUpdate.value = await window.agentkeeper.appUpdates.getState()
  removeAppUpdateListener = window.agentkeeper.appUpdates.onStateChanged((next) => {
    appUpdate.value = next
  })
})

onUnmounted(() => removeAppUpdateListener?.())

async function checkForAppUpdate() {
  appUpdate.value = await window.agentkeeper.appUpdates.check()
}

async function downloadAppUpdate() {
  try {
    await window.agentkeeper.appUpdates.download()
  } catch (error) {
    toast.error('Update download failed', {
      description: error instanceof Error ? error.message : String(error),
    })
  }
}

function installAppUpdate() {
  void window.agentkeeper.appUpdates.install()
}

const DIRTY_FIELDS = [
  'defaultModel', 'defaultEffort', 'defaultUseWorktree',
  'enterToSend', 'sendModifier', 'sessionExpiryEnabled', 'sessionExpiryDays', 'notifications', 'notificationSound',
  'gitSwitchWithoutSoftReject',
  'harnessId',
] as const satisfies ReadonlyArray<keyof AppSettings>

const isDirty = computed(() => {
  if (activeTab.value !== 'general') return false
  if (Object.values(harnessSecretInputs.value).some((value) => value.trim())) return true
  if (JSON.stringify(harnessConfigValues.value) !== JSON.stringify(harnessConfigBaseline.value)) return true
  if (!settings.value || !baseline.value) return false
  return DIRTY_FIELDS.some((f) => settings.value![f] !== baseline.value![f])
})

const isMac = /Mac/i.test(navigator.platform)
const capturing = ref(false)

const modifierLabel = computed(() => {
  const mod = settings.value?.sendModifier ?? 'auto'
  const auto = isMac ? '⌘ Command' : 'Ctrl'
  switch (mod) {
    case 'auto':  return `System default (${auto})`
    case 'meta':  return isMac ? '⌘ Command' : 'Meta'
    case 'ctrl':  return 'Ctrl'
    case 'alt':   return isMac ? '⌥ Option' : 'Alt'
    case 'shift': return '⇧ Shift'
  }
})

function captureModifier(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    settings.value!.sendModifier = 'auto'
    ;(e.currentTarget as HTMLElement).blur()
    return
  }
  if (e.key === 'Meta')         settings.value!.sendModifier = 'meta'
  else if (e.key === 'Control') settings.value!.sendModifier = 'ctrl'
  else if (e.key === 'Alt')     settings.value!.sendModifier = 'alt'
  else if (e.key === 'Shift')   settings.value!.sendModifier = 'shift'
}

const { effortLevelsFor } = useModelsQuery()

// Which harness new sessions actually run on (persisted active harness, with
// the IPC query as a fresher fallback). The auth + default-model sections
// adapt their copy/controls to it.
const { data: activeHarness } = useActiveHarness()
const { data: harnesses } = useHarnessList()
const setActiveHarness = useSetActiveHarness()
const activeHarnessId = computed(() => activeHarness.value?.id ?? settings.value?.harnessId)
const activeHarnessName = computed(
  () =>
    activeHarness.value?.name ??
    harnesses.value?.find((h) => h.id === settings.value?.harnessId)?.name ??
    'agent harness',
)
const activeHarnessDescriptor = computed(() => harnesses.value?.find((h) => h.id === activeHarnessId.value))
const harnessConfigValues = ref<Record<string, string | boolean>>({})
const harnessConfigBaseline = ref<Record<string, string | boolean>>({})
const harnessSecretInputs = ref<Record<string, string>>({})
const harnessSecretFields = ref<string[]>([])

async function loadHarnessConfiguration(id?: string) {
  if (!id) return
  const state = await window.agentkeeper.harness.getConfiguration(id)
  harnessConfigValues.value = { ...state.values }
  harnessConfigBaseline.value = { ...state.values }
  harnessSecretFields.value = state.secretFields
  harnessSecretInputs.value = {}
}

watch(activeHarnessId, (id) => { void loadHarnessConfiguration(id) }, { immediate: true })

const authenticatingHarnessId = ref<string | null>(null)

async function authenticateHarness(id: string) {
  authenticatingHarnessId.value = id
  try {
    await window.agentkeeper.harness.authenticate(id)
    await queryClient.invalidateQueries({ queryKey: queryKeys.harness.auth() })
    toast.success('Authentication completed')
  } catch (error) {
    toast.error('Could not authenticate', {
      description: error instanceof Error ? error.message : String(error),
    })
  } finally {
    authenticatingHarnessId.value = null
  }
}

// ─── Harness diagnostics ───────────────────────────────────────────────────────

const { data: harnessAuth } = useHarnessAuth()

function authFor(id: string) {
  return harnessAuth.value?.find((a) => a.id === id)
}

// Danger-zone state
const resetAppSettingsSel = ref(false)
const resetProjectSel = ref(false)
const resetGlobalSel = ref(false)
const resetting = ref(false)
const resetMessage = ref<string | null>(null)

const canReset = computed(
  () =>
    resetAppSettingsSel.value ||
    (resetProjectSel.value && !!projectPath.value) ||
    resetGlobalSel.value,
)

function seedFromQuery() {
  const s = storedSettings.value
  if (s) {
    const effort = ROLE_EFFORT_VALUES.includes(s.defaultEffort) ? s.defaultEffort : 'medium'
    const seeded = { ...s, defaultEffort: effort }
    settings.value = seeded
    baseline.value = { ...seeded }
  }
}

watch(storedSettings, (s) => {
  if (s) seedFromQuery()
}, { immediate: true })

function cancel() {
  if (baseline.value) settings.value = { ...baseline.value }
  harnessSecretInputs.value = {}
  router.back()
}

async function save() {
  saving.value = true
  try {
    if (activeHarnessId.value) {
      await window.agentkeeper.harness.setConfiguration(activeHarnessId.value, harnessConfigValues.value)
      for (const [fieldId, value] of Object.entries(harnessSecretInputs.value)) {
        if (value.trim()) await window.agentkeeper.harness.setSecret(activeHarnessId.value, fieldId, value.trim())
      }
      await loadHarnessConfiguration(activeHarnessId.value)
      await queryClient.invalidateQueries({ queryKey: queryKeys.harness.auth() })
    }
    if (settings.value) {
      const toSave: Partial<AppSettings> = {
        defaultModel: settings.value.defaultModel,
        defaultEffort: settings.value.defaultEffort,
        defaultUseWorktree: settings.value.defaultUseWorktree,
        enterToSend: settings.value.enterToSend,
        sendModifier: settings.value.sendModifier,
        sessionExpiryEnabled: settings.value.sessionExpiryEnabled,
        sessionExpiryDays: settings.value.sessionExpiryDays,
        notifications: settings.value.notifications,
        notificationSound: settings.value.notificationSound,
        gitSwitchWithoutSoftReject: settings.value.gitSwitchWithoutSoftReject,
        harnessId: settings.value.harnessId,
      }
      await window.agentkeeper.settings.set(toSave)
      if (settings.value.harnessId) await setActiveHarness.mutateAsync(settings.value.harnessId)
      queryClient.setQueryData(queryKeys.settings.app(), { ...settings.value })
    }
    toast.success('Settings saved')
  } catch (e) {
    toast.error('Failed to save settings', {
      description: e instanceof Error ? e.message : String(e),
    })
  } finally {
    saving.value = false
  }
}

async function clearHarnessSecret(fieldId: string) {
  if (!activeHarnessId.value) return
  await window.agentkeeper.harness.deleteSecret(activeHarnessId.value, fieldId)
  await loadHarnessConfiguration(activeHarnessId.value)
  await queryClient.invalidateQueries({ queryKey: queryKeys.harness.auth() })
}

async function onReset() {
  if (!canReset.value) return
  const scopes: string[] = []
  if (resetAppSettingsSel.value) scopes.push('app settings')
  if (resetProjectSel.value && projectPath.value)
    scopes.push('project definitions')
  if (resetGlobalSel.value) scopes.push('global definitions')

  // eslint-disable-next-line no-alert
  const ok = confirm(
    `This will permanently reset: ${scopes.join(', ')}.\n\nWorktrees and Claude Code state are NOT touched. This can't be undone (except via git for committed role/agency files).\n\nContinue?`,
  )
  if (!ok) return

  resetting.value = true
  resetMessage.value = null
  try {
    const result = await window.agentkeeper.reset.execute({
      appSettings: resetAppSettingsSel.value,
      globalDefinitions: resetGlobalSel.value,
      projectDefinitions:
        resetProjectSel.value && projectPath.value
          ? { projectPath: projectPath.value }
          : null,
    })
    const cleared: string[] = []
    if (result.appSettingsCleared) cleared.push('app settings')
    if (result.projectDefinitionsCleared) cleared.push('project definitions')
    if (result.globalDefinitionsCleared) cleared.push('global definitions')

    resetMessage.value = result.errors.length
      ? `Cleared: ${cleared.join(', ') || 'nothing'}. Errors: ${result.errors.join('; ')}`
      : `Cleared: ${cleared.join(', ')}. Restart the app to pick up the changes.`

    resetAppSettingsSel.value = false
    resetProjectSel.value = false
    resetGlobalSel.value = false
    invalidateAll()
  } catch (err) {
    resetMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Settings">
      <template #actions>
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
      </template>
    </PageHeader>

    <!-- Tab bar -->
    <div class="shrink-0 flex border-b border-border px-4 gap-1">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="px-3 py-2 text-sm transition-colors relative"
        :class="
          activeTab === tab.id
            ? 'text-foreground font-medium after:absolute after:bottom-0 after:inset-x-0 after:h-0.5 after:bg-primary'
            : 'text-muted-foreground hover:text-foreground'
        "
        @click="selectTab(tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto">
      <!-- Plugin tab panels -->
      <div v-if="activePluginPanel" class="p-6 max-w-2xl">
        <component :is="activePluginPanel.component" />
      </div>

      <!-- General tab -->
      <div v-else>
        <div v-if="isLoading && !settings" class="flex items-center justify-center h-32 text-sm text-muted-foreground">
          Loading…
        </div>
        <div v-else class="p-6 space-y-6 max-w-2xl">

          <!-- Harness status -->
          <section v-if="harnesses && harnesses.length > 1" class="space-y-3">
            <h2 class="text-sm font-semibold">Agent harnesses</h2>
            <div class="rounded-lg border divide-y">
              <div v-for="h in harnesses" :key="h.id" class="flex items-center gap-3 px-4 py-3">
                <span
                  class="size-2 shrink-0 rounded-full"
                  :class="!h.available || authFor(h.id)?.status === 'unauthenticated' || authFor(h.id)?.status === 'expired' ? 'bg-destructive' : authFor(h.id)?.status === 'unknown' ? 'bg-amber-500' : 'bg-emerald-500'"
                />
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">{{ h.name }}</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    <template v-if="h.available">
                      <span v-if="authFor(h.id)?.status === 'authenticated'" class="text-emerald-600 dark:text-emerald-400">Authenticated</span>
                      <span v-else-if="authFor(h.id)?.status === 'unauthenticated'" class="text-destructive">Not authenticated</span>
                      <span v-else-if="authFor(h.id)?.status === 'expired'" class="text-destructive">Authentication expired</span>
                      <span v-else class="text-amber-600 dark:text-amber-400">Available</span>
                      <span v-if="authFor(h.id)"> · {{ authFor(h.id)!.detail }}</span>
                    </template>
                    <template v-else>
                      <span class="text-destructive">{{ h.unavailableReason ?? 'Unavailable' }}</span>
                      <span v-if="authFor(h.id) && authFor(h.id)!.detail"> · {{ authFor(h.id)!.detail }}</span>
                    </template>
                  </p>
                </div>
                <Button
                  v-if="h.available && h.authentication?.login"
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="authenticatingHarnessId !== null || authFor(h.id)?.status === 'authenticated'"
                  @click="authenticateHarness(h.id)"
                >
                  {{
                    authenticatingHarnessId === h.id
                      ? 'Authenticating…'
                      : authFor(h.id)?.status === 'authenticated'
                        ? 'Authenticated'
                        : (h.authentication.login.label ?? 'Authenticate')
                  }}
                </Button>
              </div>
            </div>
          </section>

          <section v-if="activeHarnessDescriptor?.configuration?.fields.length" class="space-y-3">
            <h2 class="text-sm font-semibold">{{ activeHarnessName }} configuration</h2>
            <div v-if="activeHarnessDescriptor?.configuration?.fields.length" class="space-y-3">
              <div v-for="field in activeHarnessDescriptor.configuration.fields" :key="field.id" class="space-y-1.5">
                <label class="text-xs font-medium">{{ field.label }}</label>
                <p v-if="field.description" class="text-xs text-muted-foreground">{{ field.description }}</p>
                <select
                  v-if="field.type === 'select'"
                  v-model="harnessConfigValues[field.id]"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option v-for="choice in field.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
                </select>
                <label v-else-if="field.type === 'boolean'" class="flex items-center gap-2 text-xs">
                  <input v-model="harnessConfigValues[field.id]" type="checkbox">
                  Enabled
                </label>
                <input
                  v-else-if="field.type === 'secret'"
                  v-model="harnessSecretInputs[field.id]"
                  type="password"
                  autocomplete="off"
                  :placeholder="harnessSecretFields.includes(field.id) ? '•••••••••• (set) — enter to replace' : field.placeholder"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
                >
                <input
                  v-else
                  v-model="harnessConfigValues[field.id]"
                  :type="field.type === 'url' ? 'url' : 'text'"
                  :placeholder="field.placeholder"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
                >
                <div v-if="field.type === 'secret' && harnessSecretFields.includes(field.id)" class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Stored in the OS keychain.</span>
                  <button type="button" class="text-xs text-destructive hover:underline" @click="clearHarnessSecret(field.id)">Remove</button>
                </div>
              </div>
            </div>
          </section>

          <!-- General settings table -->
          <section v-if="settings" class="space-y-3">
            <h2 class="text-sm font-semibold">General</h2>
            <div class="rounded-lg border divide-y">

              <!-- Default model -->
              <div class="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(12rem,1fr)_minmax(16rem,22rem)] sm:items-center">
                <div class="min-w-0">
                  <p class="text-sm font-medium">Default model</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Harness and model used for new sessions; overridable per session.
                  </p>
                </div>
                <ExecutionTargetPicker
                  :model-value="settings.defaultModel"
                  :harness-id="settings.harnessId"
                  :allow-agencies="false"
                  :harness-switchable="true"
                  display="field"
                  @update:model-value="settings.defaultModel = $event"
                  @update:harness-id="settings.harnessId = $event"
                />
              </div>

              <!-- Default effort -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Default effort</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Thinking budget for new sessions; overridable per session or role.
                  </p>
                </div>
                <select
                  v-model="settings.defaultEffort"
                  class="shrink-0 w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
                >
                  <option v-for="e in effortLevelsFor(settings.defaultModel)" :key="e" :value="e">
                    {{ e }}
                  </option>
                </select>
              </div>

              <!-- Use worktree -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Use worktree by default</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    New sessions run in an isolated git worktree. Overridable per session.
                  </p>
                </div>
                <label class="relative shrink-0 cursor-pointer">
                  <input v-model="settings.defaultUseWorktree" type="checkbox" class="sr-only peer" />
                  <div class="w-9 h-5 rounded-full border border-input bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors" />
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
                </label>
              </div>

              <!-- Branch switch soft-reject -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Switch branches without warning</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Skip the uncommitted-changes warning when switching branches. Changes are carried over, never lost.
                  </p>
                </div>
                <label class="relative shrink-0 cursor-pointer">
                  <input v-model="settings.gitSwitchWithoutSoftReject" type="checkbox" class="sr-only peer" />
                  <div class="w-9 h-5 rounded-full border border-input bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors" />
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
                </label>
              </div>

              <!-- Auto-delete old sessions (opt-in) -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Auto-delete old sessions</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    When on, persisted sessions older than the age below are deleted on app startup and shutdown. Off by default.
                  </p>
                </div>
                <label class="relative shrink-0 cursor-pointer">
                  <input v-model="settings.sessionExpiryEnabled" type="checkbox" class="sr-only peer" />
                  <div class="w-9 h-5 rounded-full border border-input bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors" />
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
                </label>
              </div>

              <!-- Session age limit -->
              <div
                v-if="settings.sessionExpiryEnabled"
                class="flex items-center gap-4 px-4 py-3"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Session age limit</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Sessions inactive longer than this are eligible for deletion.
                  </p>
                </div>
                <select
                  :value="settings.sessionExpiryDays === null ? 'never' : String(settings.sessionExpiryDays)"
                  class="shrink-0 w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
                  @change="
                    (e) => {
                      const v = (e.target as HTMLSelectElement).value
                      settings!.sessionExpiryDays = v === 'never' ? null : Number(v)
                    }
                  "
                >
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7">7 days</option>
                  <option value="14">14 days (default)</option>
                  <option value="21">21 days</option>
                  <option value="30">30 days</option>
                  <option value="never">Never</option>
                </select>
              </div>

              <!-- Session notifications -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Session notifications</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Notify when a session becomes idle or completes.
                  </p>
                </div>
                <select
                  :value="settings.notifications ?? 'all'"
                  class="shrink-0 w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
                  @change="(e) => { settings!.notifications = (e.target as HTMLSelectElement).value as AppSettings['notifications'] }"
                >
                  <option value="all">Desktop notification + sound</option>
                  <option value="notification-only">Desktop notification only</option>
                  <option value="sound-only">Sound only</option>
                  <option value="toast">In-app toast only</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>

              <!-- Notification sound (only relevant when a sound mode is active) -->
              <div
                v-if="settings.notifications === 'all' || settings.notifications === 'sound-only'"
                class="flex items-center gap-4 px-4 py-3"
              >
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Notification sound</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Sound played when a session completes.
                  </p>
                </div>
                <div class="shrink-0 flex items-center gap-2">
                  <select
                    :value="settings.notificationSound ?? 'chime'"
                    class="w-36 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
                    @change="(e) => { settings!.notificationSound = (e.target as HTMLSelectElement).value as AppSettings['notificationSound'] }"
                  >
                    <option v-for="s in NOTIFICATION_SOUND_VALUES" :key="s" :value="s">
                      {{ NOTIFICATION_SOUND_LABELS[s] }}
                    </option>
                  </select>
                  <button
                    type="button"
                    class="rounded-md border border-input bg-background px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                    @click="playNotificationSound(settings.notificationSound ?? 'chime')"
                  >
                    Preview
                  </button>
                </div>
              </div>

            </div>
          </section>

          <!-- Message sending -->
          <section v-if="settings" class="space-y-3">
            <h2 class="text-sm font-semibold">Message sending</h2>
            <div class="rounded-lg border divide-y">

              <!-- Enter to send -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Enter to send</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    When on: Enter sends, modifier+Enter inserts a newline.<br />
                    When off: modifier+Enter sends, Enter inserts a newline.
                  </p>
                </div>
                <label class="relative shrink-0 cursor-pointer">
                  <input v-model="settings.enterToSend" type="checkbox" class="sr-only peer" />
                  <div class="w-9 h-5 rounded-full border border-input bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors" />
                  <div class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4" />
                </label>
              </div>

              <!-- Send modifier -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Send modifier key</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Click the field then press ⌘, Ctrl, Alt, or ⇧ Shift to set. Esc to reset.
                  </p>
                </div>
                <div
                  tabindex="0"
                  class="shrink-0 w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-pointer select-none focus:outline-none focus:border-ring transition-colors"
                  @keydown.prevent="captureModifier"
                  @focus="capturing = true"
                  @blur="capturing = false"
                >
                  <span>{{ modifierLabel }}</span>
                  <span v-if="capturing" class="text-muted-foreground italic ml-1 text-xs">— press key</span>
                </div>
              </div>

            </div>
          </section>

          <!-- Application updates -->
          <section v-if="appUpdate" class="space-y-3">
            <h2 class="text-sm font-semibold">AgentKeeper updates</h2>
            <div class="rounded-lg border px-4 py-3 space-y-3">
              <div class="flex items-center gap-4">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Version {{ appUpdate.currentVersion }}</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    <template v-if="appUpdate.status === 'unsupported'">{{ appUpdate.message }}</template>
                    <template v-else-if="appUpdate.status === 'checking'">Checking for updates…</template>
                    <template v-else-if="appUpdate.status === 'available'">Version {{ appUpdate.availableVersion }} is available.</template>
                    <template v-else-if="appUpdate.status === 'downloading'">Downloading version {{ appUpdate.availableVersion }}… {{ appUpdate.progressPercent ?? 0 }}%</template>
                    <template v-else-if="appUpdate.status === 'downloaded'">Version {{ appUpdate.availableVersion }} is ready to install.</template>
                    <template v-else-if="appUpdate.status === 'up-to-date'">AgentKeeper is up to date.</template>
                    <template v-else-if="appUpdate.status === 'error'">{{ appUpdate.message ?? 'Update check failed.' }}</template>
                    <template v-else>Updates are checked shortly after startup.</template>
                  </p>
                </div>
                <Button
                  v-if="appUpdate.status === 'available'"
                  size="sm"
                  @click="downloadAppUpdate"
                >
                  Download update
                </Button>
                <Button
                  v-else-if="appUpdate.status === 'downloaded'"
                  size="sm"
                  @click="installAppUpdate"
                >
                  Restart and install
                </Button>
                <Button
                  v-else
                  variant="outline"
                  size="sm"
                  :disabled="appUpdate.status === 'checking' || appUpdate.status === 'downloading' || appUpdate.status === 'unsupported'"
                  @click="checkForAppUpdate"
                >
                  Check for updates
                </Button>
              </div>
              <div v-if="appUpdate.status === 'downloading'" class="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full bg-primary transition-[width]"
                  :style="{ width: `${appUpdate.progressPercent ?? 0}%` }"
                />
              </div>
              <p v-if="appUpdate.releaseNotes" class="text-xs text-muted-foreground whitespace-pre-wrap border-t pt-3">
                {{ appUpdate.releaseNotes }}
              </p>
            </div>
          </section>

          <!-- Appearance -->
          <section class="space-y-3">
            <h2 class="text-sm font-semibold">Appearance</h2>
            <div class="flex gap-2">
              <button
                class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors"
                :class="
                  layoutStore.theme === 'light'
                    ? 'border-ring bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
                "
                @click="void layoutStore.setTheme('light')"
              >
                Light
              </button>
              <button
                class="flex-1 rounded-md border px-3 py-2 text-sm transition-colors"
                :class="
                  layoutStore.theme === 'dark'
                    ? 'border-ring bg-primary text-primary-foreground'
                    : 'border-input bg-background hover:bg-accent hover:text-accent-foreground'
                "
                @click="void layoutStore.setTheme('dark')"
              >
                Dark
              </button>
            </div>
          </section>

          <!-- Danger zone -->
          <details class="group rounded-md border border-destructive/40 bg-destructive/5">
            <summary
              class="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center justify-between"
            >
              <span>Danger zone</span>
              <span class="text-xs text-muted-foreground group-open:hidden">click to expand</span>
            </summary>
            <div class="px-3 pb-3 pt-1 space-y-3">
              <p class="text-xs text-muted-foreground">
                Resets are permanent. Worktrees and Claude Code state
                (<code class="font-mono">~/.claude/</code>) are never touched.
              </p>

              <div class="space-y-2">
                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    v-model="resetAppSettingsSel"
                    type="checkbox"
                    class="size-4 mt-0.5 rounded border-input shrink-0"
                  />
                  <div class="text-xs min-w-0">
                    <div class="font-medium text-foreground">App settings</div>
                    <div class="text-muted-foreground">
                      Default model, default effort, and the API key stored in the OS keychain.
                    </div>
                  </div>
                </label>

                <label
                  v-if="projectPath"
                  class="flex items-start gap-2 cursor-pointer select-none"
                >
                  <input
                    v-model="resetProjectSel"
                    type="checkbox"
                    class="size-4 mt-0.5 rounded border-input shrink-0"
                  />
                  <div class="text-xs min-w-0">
                    <div class="font-medium text-foreground">Project role &amp; agency definitions</div>
                    <div class="text-muted-foreground font-mono truncate">
                      {{ projectPath }}/.agentkeeper/
                    </div>
                    <div class="text-muted-foreground mt-0.5">
                      Restore with <code class="font-mono">git checkout .agentkeeper</code> if needed.
                    </div>
                  </div>
                </label>

                <label class="flex items-start gap-2 cursor-pointer select-none">
                  <input
                    v-model="resetGlobalSel"
                    type="checkbox"
                    class="size-4 mt-0.5 rounded border-input shrink-0"
                  />
                  <div class="text-xs min-w-0">
                    <div class="font-medium text-foreground">Global role &amp; agency definitions</div>
                    <div class="text-muted-foreground font-mono">~/.agentkeeper/</div>
                  </div>
                </label>
              </div>

              <div
                v-if="resetMessage"
                class="text-xs rounded-md bg-background/60 border border-border px-3 py-2"
              >
                {{ resetMessage }}
              </div>

              <div class="flex items-center justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  :disabled="!canReset || resetting"
                  @click="onReset"
                >
                  {{ resetting ? 'Resetting…' : 'Reset selected' }}
                </Button>
              </div>
            </div>
          </details>

        </div>
      </div>
    </div>

    <!-- Sticky footer: Save/Cancel only shown on General tab -->
    <footer
      v-if="activeTab === 'general'"
      class="shrink-0 border-t bg-background px-6 py-3 flex items-center justify-end gap-2"
    >
      <Button variant="ghost" size="sm" @click="cancel">Cancel</Button>
      <Button size="sm" :disabled="saving || !isDirty" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </Button>
    </footer>
  </div>
</template>
