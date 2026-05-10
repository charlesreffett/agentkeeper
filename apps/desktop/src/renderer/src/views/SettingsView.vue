<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { ROLE_EFFORT_VALUES, type AppSettings } from '@shared/ipc-contract'
import { useLayoutStore } from '@/stores/layout'
import { useProjectsStore } from '@/stores/projects'
import { useAppSettingsStore } from '@/stores/appSettings'

const layoutStore = useLayoutStore()
const projectsStore = useProjectsStore()
const appSettingsStore = useAppSettingsStore()
const projectPath = computed(() => projectsStore.focusedProject?.path ?? '')

const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

const apiKeyInput = ref('')
const keyStored = ref(false)
const settings = ref<AppSettings | null>(null)
const saving = ref(false)
const message = ref<string | null>(null)

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
  newRepoInput.value = ''
}

async function removeRepo(repo: string) {
  githubRepos.value = githubRepos.value.filter((r) => r !== repo)
  await window.agentkeeper.github.setConfig({ repos: githubRepos.value })
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

async function refresh() {
  appSettingsStore.invalidate()
  await appSettingsStore.load()
  // Seed local editable copies from the store
  const s = appSettingsStore.settings
  if (s) {
    // Defensive: fall back to 'medium' if defaultEffort is missing/invalid
    if (!s.defaultEffort || !ROLE_EFFORT_VALUES.includes(s.defaultEffort)) {
      s.defaultEffort = 'medium'
    }
    settings.value = { ...s }
  }
  keyStored.value = appSettingsStore.apiKeyStored
  apiKeyInput.value = ''
  message.value = null
  githubRepos.value = appSettingsStore.githubConfig.repos ?? []
  newRepoInput.value = ''
  newRepoError.value = null
}

async function save() {
  saving.value = true
  message.value = null
  try {
    if (apiKeyInput.value.trim()) {
      await window.agentkeeper.secrets.set(
        'anthropicApiKey',
        apiKeyInput.value.trim(),
      )
    }
    if (settings.value) {
      await window.agentkeeper.settings.set({
        defaultModel: settings.value.defaultModel,
        defaultEffort: settings.value.defaultEffort,
        defaultUseWorktree: settings.value.defaultUseWorktree,
        enterToSend: settings.value.enterToSend,
        sendModifier: settings.value.sendModifier,
        sessionExpiryDays: settings.value.sessionExpiryDays,
      })
    }
    message.value = 'Saved.'
    await refresh()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  await window.agentkeeper.secrets.delete('anthropicApiKey')
  await refresh()
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
    await refresh()
  } catch (err) {
    resetMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    resetting.value = false
  }
}

onMounted(async () => {
  // If the store already has a completed load, seed from it immediately
  // before re-fetching, so the UI is never blank on first paint.
  if (appSettingsStore.settings) {
    const s = appSettingsStore.settings
    if (!s.defaultEffort || !ROLE_EFFORT_VALUES.includes(s.defaultEffort)) {
      s.defaultEffort = 'medium'
    }
    settings.value = { ...s }
    keyStored.value = appSettingsStore.apiKeyStored
    githubRepos.value = appSettingsStore.githubConfig.repos ?? []
  }
  await refresh()
})
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="p-6 space-y-5 max-w-lg">
      <header class="flex items-center justify-between">
        <h2 class="text-lg font-semibold">Settings</h2>
      </header>

      <div class="space-y-3">
        <label class="text-sm font-medium">Authentication</label>
        <div
          class="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed space-y-1"
        >
          <p class="text-foreground font-medium">
            If you have a Claude Pro or Max plan
          </p>
          <p class="text-muted-foreground">
            Run <code class="font-mono bg-background px-1 rounded">claude login</code>
            in a terminal once. The app shares those credentials — no API key
            needed here.
          </p>
        </div>
        <div class="space-y-2">
          <p class="text-xs text-muted-foreground">
            Or, if you have an Anthropic Console account, paste an API key below
            (stored in your OS keychain via keytar):
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
            <span class="text-xs text-muted-foreground">
              API key is configured.
            </span>
            <button
              class="text-xs text-destructive hover:underline"
              @click="clearKey"
            >
              Remove key
            </button>
          </div>
        </div>
      </div>

      <div v-if="settings" class="space-y-2">
        <label class="text-sm font-medium">Default model</label>
        <select
          v-model="settings.defaultModel"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        >
          <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
      </div>

      <div v-if="settings" class="space-y-2">
        <label class="text-sm font-medium">Default effort</label>
        <p class="text-xs text-muted-foreground">
          Baseline effort level for new sessions. A selected role can
          override this, and you can override either from the New Session
          dialog.
        </p>
        <select
          v-model="settings.defaultEffort"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        >
          <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">
            {{ e }}
          </option>
        </select>
      </div>

      <div v-if="settings" class="space-y-2">
        <label class="text-sm font-medium">Sessions</label>
        <label class="flex items-start gap-3 cursor-pointer select-none group">
          <div class="relative mt-0.5 shrink-0">
            <input
              v-model="settings.defaultUseWorktree"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-9 h-5 rounded-full border border-input bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors"
            />
            <div
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4"
            />
          </div>
          <div class="text-xs leading-relaxed">
            <div class="font-medium text-foreground">Use worktree by default</div>
            <div class="text-muted-foreground">
              When on: new sessions default to an isolated git worktree.<br />
              When off (default): sessions run in the project directory.
            </div>
          </div>
        </label>
      </div>

      <div v-if="settings" class="space-y-2">
        <label class="text-sm font-medium">Message sending</label>
        <label class="flex items-start gap-3 cursor-pointer select-none group">
          <div class="relative mt-0.5 shrink-0">
            <input
              v-model="settings.enterToSend"
              type="checkbox"
              class="sr-only peer"
            />
            <div
              class="w-9 h-5 rounded-full border border-input bg-muted peer-checked:bg-primary peer-checked:border-primary transition-colors"
            />
            <div
              class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-4"
            />
          </div>
          <div class="text-xs leading-relaxed">
            <div class="font-medium text-foreground">Enter to send</div>
            <div class="text-muted-foreground">
              When on: Enter sends, modifier+Enter inserts a newline.<br />
              When off (default): modifier+Enter sends, Enter inserts a newline.
            </div>
          </div>
        </label>
        <div class="space-y-1.5 pt-1">
          <label class="text-xs font-medium">Send modifier key</label>
          <div
            tabindex="0"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm cursor-pointer select-none focus:outline-none focus:border-ring transition-colors"
            @keydown.prevent="captureModifier"
            @focus="capturing = true"
            @blur="capturing = false"
          >
            <span>{{ modifierLabel }}</span>
            <span v-if="capturing" class="text-muted-foreground italic ml-2">— press to change</span>
          </div>
          <p class="text-[11px] text-muted-foreground">
            Press ⌘, Ctrl, Alt, or ⇧ Shift to set. Press Esc to reset to system default.
          </p>
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">GitHub repositories</label>
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
      </div>

      <div v-if="settings" class="space-y-2">
        <label class="text-sm font-medium">Session history</label>
        <p class="text-xs text-muted-foreground">
          Persisted sessions older than this threshold are removed at startup.
        </p>
        <select
          :value="settings.sessionExpiryDays === null ? 'never' : String(settings.sessionExpiryDays)"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
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

      <div
        v-if="message"
        class="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2"
      >
        {{ message }}
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">Appearance</label>
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
      </div>

      <details class="group rounded-md border border-destructive/40 bg-destructive/5">
        <summary
          class="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center justify-between"
        >
          <span>Danger zone</span>
          <span class="text-xs text-muted-foreground group-open:hidden">
            click to expand
          </span>
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
                  Default model, default effort, and the API key stored in the
                  OS keychain.
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
                <div class="font-medium text-foreground">
                  Project role &amp; agency definitions
                </div>
                <div class="text-muted-foreground font-mono truncate">
                  {{ projectPath }}/.agentkeeper/
                </div>
                <div class="text-muted-foreground mt-0.5">
                  These are usually committed to git — restore with
                  <code class="font-mono">git checkout .agentkeeper</code>
                  if you regret it.
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
                <div class="font-medium text-foreground">
                  Global role &amp; agency definitions
                </div>
                <div class="text-muted-foreground font-mono">
                  ~/.agentkeeper/
                </div>
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

      <footer class="flex items-center justify-end gap-2 pt-2">
        <Button size="sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </footer>
    </div>
  </div>
</template>
