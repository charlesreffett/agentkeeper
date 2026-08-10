<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { ROLE_EFFORT_VALUES, type AppSettings } from '@shared/ipc-contract'
import { NOTIFICATION_SOUND_VALUES, NOTIFICATION_SOUND_LABELS, playNotificationSound } from '@/lib/notificationSound'
import { useLayoutStore } from '@/stores/layout'
import { usePageScope } from '@/composables/usePageScope'
import ScopeBar from '@/components/ScopeBar.vue'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { queryKeys } from '@/lib/queryKeys'
import { pluginSettingsPanels } from '@/lib/pluginSettingsPanels'
import { useModelsQuery } from '@/composables/useModelsQuery'
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
  apiKeyStored: storedApiKeyStored,
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

const apiKeyInput = ref('')
const keyStored = ref(false)
const settings = ref<AppSettings | null>(null)
const baseline = ref<AppSettings | null>(null)
const saving = ref(false)

const DIRTY_FIELDS = [
  'defaultModel', 'defaultEffort', 'defaultUseWorktree',
  'enterToSend', 'sendModifier', 'sessionExpiryEnabled', 'sessionExpiryDays', 'notifications', 'notificationSound',
  'gitSwitchWithoutSoftReject',
] as const satisfies ReadonlyArray<keyof AppSettings>

const isDirty = computed(() => {
  if (activeTab.value !== 'general') return false
  if (apiKeyInput.value.trim()) return true
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

const { optionsFor: modelOptionsFor, effortLevelsFor, error: modelsError, isEmpty: noModels } = useModelsQuery()

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
  if (storedApiKeyStored.value != null) keyStored.value = storedApiKeyStored.value
}

watch(storedSettings, (s) => {
  if (s) seedFromQuery()
}, { immediate: true })

watch(storedApiKeyStored, (v) => {
  if (v != null) keyStored.value = v
})

function cancel() {
  if (baseline.value) settings.value = { ...baseline.value }
  apiKeyInput.value = ''
  router.back()
}

async function save() {
  saving.value = true
  try {
    if (apiKeyInput.value.trim()) {
      await window.agentkeeper.secrets.set('anthropicApiKey', apiKeyInput.value.trim())
      queryClient.setQueryData(queryKeys.settings.secrets(), true)
      apiKeyInput.value = ''
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
      }
      await window.agentkeeper.settings.set(toSave)
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

async function clearKey() {
  await window.agentkeeper.secrets.delete('anthropicApiKey')
  queryClient.setQueryData(queryKeys.settings.secrets(), false)
  keyStored.value = false
  invalidateAll()
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

          <!-- Authentication -->
          <section class="space-y-3">
            <h2 class="text-sm font-semibold">Authentication</h2>
            <div class="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed space-y-1">
              <p class="text-foreground font-medium">Claude Pro or Max plan</p>
              <p class="text-muted-foreground">
                Run <code class="font-mono bg-background px-1 rounded">claude login</code>
                in a terminal once. The app shares those credentials — no API key needed here.
              </p>
            </div>
            <div class="space-y-2">
              <p class="text-xs text-muted-foreground">
                Anthropic Console key (stored in OS keychain via keytar):
              </p>
              <input
                v-model="apiKeyInput"
                type="password"
                autocomplete="off"
                :placeholder="
                  keyStored
                    ? '•••••••••• (key set) — enter new to replace'
                    : 'sk-ant-… (optional)'
                "
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              />
              <div v-if="keyStored" class="flex items-center justify-between">
                <span class="text-xs text-muted-foreground">API key is configured.</span>
                <button class="text-xs text-destructive hover:underline" @click="clearKey">
                  Remove key
                </button>
              </div>
            </div>
          </section>

          <!-- General settings table -->
          <section v-if="settings" class="space-y-3">
            <h2 class="text-sm font-semibold">General</h2>
            <div class="rounded-lg border divide-y">

              <!-- Default model -->
              <div class="flex items-center gap-4 px-4 py-3">
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium">Default model</p>
                  <p class="text-xs text-muted-foreground mt-0.5">
                    Baseline model for new sessions; overridable per session.
                  </p>
                </div>
                <select
                  v-model="settings.defaultModel"
                  :disabled="noModels"
                  class="shrink-0 w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring disabled:opacity-50"
                >
                  <option v-for="m in modelOptionsFor(settings.defaultModel)" :key="m.value" :value="m.value">
                    {{ m.label }}
                  </option>
                </select>
                <p v-if="modelsError" class="text-xs text-destructive">Harness unavailable.</p>
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
