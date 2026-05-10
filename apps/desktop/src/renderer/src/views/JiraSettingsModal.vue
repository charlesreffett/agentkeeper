<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const projectKey = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      saving.value = false
      saveError.value = null
      projectKey.value = ''
      try {
        const cfg = (await window.agentkeeper.plugins.getConfig('jira')) as
          | Record<string, unknown>
          | null
          | undefined
        if (cfg && typeof cfg.projectKey === 'string') {
          projectKey.value = cfg.projectKey
        }
      } catch {
        // non-fatal: start with empty field
      }
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

async function save() {
  saving.value = true
  saveError.value = null
  try {
    await window.agentkeeper.plugins.setConfig('jira', {
      projectKey: projectKey.value.trim() || undefined,
    })
    emit('saved')
    emit('close')
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/25 backdrop:backdrop-blur-md max-w-sm w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <span class="font-semibold text-sm">Jira Settings</span>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <form class="p-4 space-y-4" @submit.prevent="save">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-foreground" for="jira-project-key">
            Project Key
          </label>
          <input
            id="jira-project-key"
            v-model="projectKey"
            type="text"
            placeholder="e.g. MYPROJ"
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring font-mono"
          />
          <p class="text-xs text-muted-foreground">
            Filter issues to a specific Jira project. Leave blank to show all.
          </p>
        </div>

        <div v-if="saveError" class="text-xs text-destructive">{{ saveError }}</div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
          <Button type="submit" size="sm" :disabled="saving">
            {{ saving ? 'Saving…' : 'Save' }}
          </Button>
        </div>
      </form>
    </div>
  </dialog>
</template>
