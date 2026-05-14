<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'

interface Mapping {
  jiraProjectKey: string
  projectPath: string
}

interface RegisteredProject {
  path: string
  name: string
  repo: string | null
  lastOpenedAt: number
}

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const mappings = ref<Mapping[]>([])
const projects = ref<RegisteredProject[]>([])
const saving = ref(false)
const saveError = ref<string | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      saving.value = false
      saveError.value = null
      mappings.value = []
      projects.value = []

      try {
        projects.value = (await window.agentkeeper.projects.list()) as RegisteredProject[]
      } catch {
        // non-fatal
      }

      try {
        const cfg = (await window.agentkeeper.plugins.getConfig('jira')) as
          | Record<string, unknown>
          | null
          | undefined

        if (cfg) {
          const stored = cfg.projectMappings
          if (Array.isArray(stored) && stored.length > 0) {
            mappings.value = stored.map((m: unknown) => {
              const row = m as Record<string, unknown>
              return {
                jiraProjectKey: typeof row.jiraProjectKey === 'string' ? row.jiraProjectKey : '',
                projectPath: typeof row.projectPath === 'string' ? row.projectPath : '',
              }
            })
          } else if (typeof cfg.projectKey === 'string' && cfg.projectKey) {
            mappings.value = [{ jiraProjectKey: cfg.projectKey, projectPath: '' }]
          }
        }
      } catch {
        // non-fatal
      }

      if (mappings.value.length === 0) {
        mappings.value = [{ jiraProjectKey: '', projectPath: '' }]
      }

      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

function addRow() {
  mappings.value.push({ jiraProjectKey: '', projectPath: '' })
}

function removeRow(index: number) {
  mappings.value.splice(index, 1)
  if (mappings.value.length === 0) {
    mappings.value = [{ jiraProjectKey: '', projectPath: '' }]
  }
}

async function save() {
  saving.value = true
  saveError.value = null
  try {
    const filtered = mappings.value
      .filter((m) => m.jiraProjectKey.trim() !== '')
      .map((m) => ({ jiraProjectKey: m.jiraProjectKey, projectPath: m.projectPath }))
    await window.agentkeeper.plugins.setConfig('jira', { projectMappings: filtered })
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
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/25 backdrop:backdrop-blur-md max-w-md w-full shadow-xl"
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
        <div class="space-y-2">
          <div class="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground px-0.5">
            <span>Jira Project Key</span>
            <span>Local Project</span>
            <span />
          </div>

          <div
            v-for="(row, i) in mappings"
            :key="i"
            class="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
          >
            <input
              v-model="row.jiraProjectKey"
              type="text"
              placeholder="e.g. GTS"
              class="bg-background border border-border rounded px-2 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-ring w-full"
            />
            <select
              v-model="row.projectPath"
              class="bg-background border border-border rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full"
            >
              <option value="">— select project —</option>
              <option v-for="p in projects" :key="p.path" :value="p.path">{{ p.name }}</option>
            </select>
            <button
              type="button"
              class="text-muted-foreground hover:text-destructive transition-colors text-base leading-none px-1"
              @click="removeRow(i)"
            >
              ×
            </button>
          </div>

          <Button type="button" variant="ghost" size="sm" class="w-full" @click="addRow">
            + Add mapping
          </Button>
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
