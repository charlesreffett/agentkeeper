<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQueryClient } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { ROLE_EFFORT_VALUES, type AppSettings } from '@shared/ipc-contract'
import { useLayoutStore } from '@/stores/layout'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { queryKeys } from '@/lib/queryKeys'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const queryClient = useQueryClient()
const layoutStore = useLayoutStore()
const { focusedProject } = useProjectsQuery()
const {
  settings: storedSettings,
  apiKeyStored: storedApiKeyStored,
  githubConfig: storedGithubConfig,
  isLoading,
  invalidateAll,
} = useSettingsQuery()
const projectPath = computed(() => focusedProject.value?.path ?? '')

const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

const apiKeyInput = ref('')
const keyStored = ref(false)
const settings = ref<AppSettings | null>(null)
const baseline = ref<AppSettings | null>(null)
const saving = ref(false)

const DIRTY_FIELDS = [
  'defaultModel', 'defaultEffort', 'defaultUseWorktree',
  'enterToSend', 'sendModifier', 'sessionExpiryDays',
] as const satisfies ReadonlyArray<keyof AppSettings>

const isDirty = computed(() => {
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

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7 (most capable)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (balanced)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fast)' },
] as const

const githubRepos = ref<string[]>([])
const newRepoInput = ref('')
const newRepoError = ref<string | null>(null)

async function addRepo() {
  const val = newRepoInput.value.trim()
  newRepoError.value = null
  if (!val) return
  if (!OWNER_REPO_RE.test(val)) {
    newRepoError.value = 'Must be owner/repo format, e.g. anthropics/claude-code.'
    return
  }
  if (githubRepos.value.includes(val)) {
    newRepoError.value = 'Repo already added.'
    return
  }
  githubRepos.value = [...githubRepos.value, val]
  await window.agentkeeper.github.setConfig({ repos: githubRepos.value })
  queryClient.setQueryData(queryKeys.settings.github(), { repos: githubRepos.value })
  newRepoInput.value = ''
}

async function removeRepo(repo: string) {
  githubRepos.value = githubRepos.value.filter((r) => r !== repo)
  await window.agentkeeper.github.setConfig({ repos: githubRepos.value })
  queryClient.setQueryData(queryKeys.settings.github(), { repos: githubRepos.value })
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
  if (storedApiKeyStored.value != null) keyStored.value = storedApiKeyStored.value
  if (storedGithubConfig.value != null) githubRepos.value = storedGithubConfig.value.repos ?? []
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
  newRepoInput.value = ''
  newRepoError.value = null
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
        sessionExpiryDays: settings.value.sessionExpiryDays,
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
    <PageHeader title="Settings" />
    <div class="flex-1 overflow-y-auto">
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
                class="shrink-0 w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
              >
                <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
                  {{ m.label }}
                </option>
              </select>
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
                <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">
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

            <!-- Session expiry -->
            <div class="flex items-center gap-4 px-4 py-3">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium">Session history</p>
                <p class="text-xs text-muted-foreground mt-0.5">
                  Persisted sessions older than this are pruned at startup.
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

        <!-- GitHub repositories -->
        <section class="space-y-3">
          <h2 class="text-sm font-semibold">GitHub repositories</h2>
          <p class="text-xs text-muted-foreground">
            Repos scoped for GitHub PR and issue operations.
          </p>
          <div v-if="githubRepos.length > 0" class="flex flex-wrap gap-2">
            <span
              v-for="repo in githubRepos"
              :key="repo"
              class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-foreground"
            >
              <span class="font-mono">{{ repo }}</span>
              <button
                class="ml-1 text-muted-foreground hover:text-destructive transition-colors leading-none"
                @click="void removeRepo(repo)"
              >×</button>
            </span>
          </div>
          <div class="flex gap-2">
            <input
              v-model="newRepoInput"
              type="text"
              placeholder="owner/repo"
              class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              @blur="void addRepo()"
              @keydown.enter.prevent="void addRepo()"
              @input="newRepoError = null"
            />
          </div>
          <p v-if="newRepoError" class="text-xs text-amber-600 dark:text-amber-400">{{ newRepoError }}</p>
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

    <!-- Sticky footer: always visible, outside scroll area -->
    <footer class="shrink-0 border-t bg-background px-6 py-3 flex items-center justify-end gap-2">
      <Button variant="ghost" size="sm" @click="cancel">Cancel</Button>
      <Button size="sm" :disabled="saving || !isDirty" @click="save">
        {{ saving ? 'Saving…' : 'Save' }}
      </Button>
    </footer>
  </div>
</template>
