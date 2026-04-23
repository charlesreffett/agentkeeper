<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { ROLE_EFFORT_VALUES, type AppSettings } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()

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

async function refresh() {
  settings.value = await window.orchestral.settings.get()
  keyStored.value = await window.orchestral.secrets.has('anthropicApiKey')
  apiKeyInput.value = ''
  message.value = null
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

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
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

      <div
        v-if="message"
        class="text-xs text-muted-foreground rounded-md bg-muted/40 px-3 py-2"
      >
        {{ message }}
      </div>

      <footer class="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
        <Button size="sm" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </footer>
    </div>
  </dialog>
</template>
