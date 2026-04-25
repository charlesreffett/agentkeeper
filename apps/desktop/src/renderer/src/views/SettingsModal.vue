<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { ROLE_EFFORT_VALUES, type AppSettings } from '@shared/ipc-contract'

const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

const props = defineProps<{ open: boolean; projectPath?: string }>()
const emit = defineEmits<{ close: []; saved: []; reset: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const apiKeyInput = ref('')
const keyStored = ref(false)
const settings = ref<AppSettings | null>(null)
const saving = ref(false)
const message = ref<string | null>(null)

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
  await window.orchestral.github.setConfig({ repos: githubRepos.value })
  newRepoInput.value = ''
}

async function removeRepo(repo: string) {
  githubRepos.value = githubRepos.value.filter((r) => r !== repo)
  await window.orchestral.github.setConfig({ repos: githubRepos.value })
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
    (resetProjectSel.value && !!props.projectPath) ||
    resetGlobalSel.value,
)

async function refresh() {
  settings.value = await window.orchestral.settings.get()
  // Defensive: if main is running an older build (no defaults for
  // defaultEffort), or the on-disk settings has an invalid value, fall
  // back to 'medium' in the UI so the dropdown never starts blank.
  if (
    !settings.value.defaultEffort ||
    !ROLE_EFFORT_VALUES.includes(settings.value.defaultEffort)
  ) {
    settings.value.defaultEffort = 'medium'
  }
  keyStored.value = await window.orchestral.secrets.has('anthropicApiKey')
  apiKeyInput.value = ''
  message.value = null
  const ghConfig = await window.orchestral.github.getConfig()
  githubRepos.value = ghConfig.repos ?? []
  newRepoInput.value = ''
  newRepoError.value = null
}

async function save() {
  saving.value = true
  message.value = null
  try {
    if (apiKeyInput.value.trim()) {
      await window.orchestral.secrets.set(
        'anthropicApiKey',
        apiKeyInput.value.trim(),
      )
    }
    if (settings.value) {
      await window.orchestral.settings.set({
        defaultModel: settings.value.defaultModel,
        defaultEffort: settings.value.defaultEffort,
        enterToSend: settings.value.enterToSend,
        sendModifier: settings.value.sendModifier,
      })
    }
    message.value = 'Saved.'
    await refresh()
    emit('saved')
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function clearKey() {
  await window.orchestral.secrets.delete('anthropicApiKey')
  await refresh()
}

async function onReset() {
  if (!canReset.value) return
  const scopes: string[] = []
  if (resetAppSettingsSel.value) scopes.push('app settings')
  if (resetProjectSel.value && props.projectPath)
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
    const result = await window.orchestral.reset.execute({
      appSettings: resetAppSettingsSel.value,
      globalDefinitions: resetGlobalSel.value,
      projectDefinitions:
        resetProjectSel.value && props.projectPath
          ? { projectPath: props.projectPath }
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
    emit('reset')
  } catch (err) {
    resetMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    resetting.value = false
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      resetAppSettingsSel.value = false
      resetProjectSel.value = false
      resetGlobalSel.value = false
      resetMessage.value = null
      await refresh()
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

onMounted(() => {
  if (props.open) {
    void refresh().then(() => dialog.value?.showModal())
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-lg w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="p-6 space-y-5">
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
          <select
            v-model="settings.sendModifier"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          >
            <option value="auto">System default (⌘ on Mac, Ctrl elsewhere)</option>
            <option value="meta">⌘ Cmd (Meta)</option>
            <option value="ctrl">Ctrl</option>
          </select>
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

      <div
        v-if="message"
        class="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2"
      >
        {{ message }}
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
                  {{ projectPath }}/.orchestral/
                </div>
                <div class="text-muted-foreground mt-0.5">
                  These are usually committed to git — restore with
                  <code class="font-mono">git checkout .orchestral</code>
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
                  ~/.orchestral/
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
        <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
        <Button size="sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </footer>
    </div>
  </dialog>
</template>
