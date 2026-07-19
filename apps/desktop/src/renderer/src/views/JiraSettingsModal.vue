<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { JiraProject } from '@shared/ipc-contract'

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
const jiraProjects = ref<JiraProject[]>([])
const loadingJiraProjects = ref(false)
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
      jiraProjects.value = []

      loadingJiraProjects.value = true
      const [cfg, jira, local] = await Promise.all([
        window.agentkeeper.plugins.getConfig('jira').catch(() => null),
        window.agentkeeper.jira.listProjects().catch(() => [] as JiraProject[]),
        window.agentkeeper.projects.list().catch(() => [] as RegisteredProject[]),
      ])
      loadingJiraProjects.value = false

      jiraProjects.value = jira
      projects.value = local

      const typed = cfg as { projectMappings?: unknown[]; projectKey?: string } | null
      if (typed?.projectMappings && Array.isArray(typed.projectMappings) && typed.projectMappings.length > 0) {
        mappings.value = typed.projectMappings.map((m: unknown) => {
          const row = m as Record<string, unknown>
          return {
            jiraProjectKey: typeof row.jiraProjectKey === 'string' ? row.jiraProjectKey : '',
            projectPath: typeof row.projectPath === 'string' ? row.projectPath : '',
          }
        })
      } else if (typeof typed?.projectKey === 'string' && typed.projectKey) {
        mappings.value = [{ jiraProjectKey: typed.projectKey, projectPath: '' }]
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
    class="rounded-lg p-0 bg-popover text-foreground border border-popover-border backdrop:bg-black/25 backdrop:backdrop-blur-md max-w-md w-full shadow-dialog"
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
            <span class="flex items-center gap-1.5">
              Jira Project
              <span v-if="loadingJiraProjects" class="text-[10px] font-normal italic">loading…</span>
            </span>
            <span>Local Project</span>
            <span />
          </div>

          <div
            v-for="(row, i) in mappings"
            :key="i"
            class="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
          >
            <!-- Jira project dropdown populated from jira project list -->
            <select
              v-model="row.jiraProjectKey"
              class="bg-background border border-border rounded px-2 py-1.5 text-sm font-mono outline-none focus:ring-1 focus:ring-ring w-full"
              :disabled="loadingJiraProjects"
            >
              <option value="">— select —</option>
              <option v-for="p in jiraProjects" :key="p.key" :value="p.key">
                {{ p.key }}{{ p.name !== p.key ? ` — ${p.name}` : '' }}
              </option>
              <!-- Preserve any existing value that didn't come back from the CLI -->
              <option
                v-if="row.jiraProjectKey && !jiraProjects.some((p) => p.key === row.jiraProjectKey)"
                :value="row.jiraProjectKey"
              >
                {{ row.jiraProjectKey }}
              </option>
            </select>

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
