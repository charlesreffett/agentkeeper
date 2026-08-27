<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { JiraProject } from '@shared/ipc-contract'
import { useSettingsLeavePrompt } from '@/composables/useSettingsLeavePrompt'

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

const mappings = ref<Mapping[]>([])
const baselineMappings = ref<Mapping[]>([])
const projects = ref<RegisteredProject[]>([])
const jiraProjects = ref<JiraProject[]>([])
const loadingJiraProjects = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const saved = ref(false)
const dialogOpen = ref(false)
const dialogSelections = ref<{ jiraProject: JiraProject; projectPath: string; selected: boolean }[]>([])

async function load() {
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
  baselineMappings.value = mappings.value.map(mapping => ({ ...mapping }))
}

onMounted(() => { void load() })

function getBoardLabel(key: string): string {
  const p = jiraProjects.value.find((j) => j.key === key)
  return p && p.name !== p.key ? `${p.key} — ${p.name}` : key
}

function openDialog() {
  const importedKeys = new Set(mappings.value.map((m) => m.jiraProjectKey))
  dialogSelections.value = jiraProjects.value
    .filter((j) => !importedKeys.has(j.key))
    .map((j) => ({ jiraProject: j, projectPath: '', selected: false }))
  dialogOpen.value = true
}

function canImport(): boolean {
  const selected = dialogSelections.value.filter((s) => s.selected)
  return selected.length > 0 && selected.every((s) => s.projectPath !== '')
}

function importBoards() {
  for (const s of dialogSelections.value.filter((s) => s.selected)) {
    mappings.value.push({ jiraProjectKey: s.jiraProject.key, projectPath: s.projectPath })
  }
  dialogOpen.value = false
}

function removeRow(index: number) {
  mappings.value.splice(index, 1)
}

async function save() {
  saving.value = true
  saveError.value = null
  saved.value = false
  try {
    const filtered = mappings.value
      .filter((m) => m.jiraProjectKey.trim() !== '')
      .map((m) => ({ jiraProjectKey: m.jiraProjectKey, projectPath: m.projectPath }))
    await window.agentkeeper.plugins.setConfig('jira', { projectMappings: filtered })
    baselineMappings.value = mappings.value.map(mapping => ({ ...mapping }))
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    saving.value = false
  }
}

const isDirty = computed(() => JSON.stringify(mappings.value) !== JSON.stringify(baselineMappings.value))
useSettingsLeavePrompt(isDirty, save)
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-start justify-between gap-4">
      <div>
        <h2 class="text-sm font-semibold mb-1">Projects</h2>
        <p class="text-xs text-muted-foreground">
          Map Jira projects to local project paths so issues and sessions stay connected.
        </p>
      </div>
      <Button type="button" size="sm" variant="outline" @click="openDialog">+ Add board</Button>
    </div>

    <form class="space-y-3" @submit.prevent="save">
      <div class="space-y-2">
        <div
          v-for="(row, i) in mappings"
          :key="i"
          class="grid grid-cols-[1fr_1fr_auto] gap-2 items-center"
        >
          <span class="text-sm font-mono truncate">{{ getBoardLabel(row.jiraProjectKey) }}</span>

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

        <p v-if="mappings.length === 0" class="text-xs text-muted-foreground py-2">
          No boards imported. Click "+ Add board" to get started.
        </p>
      </div>

      <div v-if="saveError" class="text-xs text-destructive">{{ saveError }}</div>

      <div class="flex items-center justify-end gap-2">
        <span v-if="saved" class="text-xs text-green-600 dark:text-green-400">Saved</span>
        <Button type="submit" size="sm" :disabled="saving">
          {{ saving ? 'Saving…' : 'Save' }}
        </Button>
      </div>
    </form>
  </div>

  <Dialog v-model:open="dialogOpen">
    <DialogContent class="max-w-lg">
      <DialogHeader>
        <DialogTitle>Import Jira boards</DialogTitle>
        <DialogDescription>
          Select boards to import. Each must be assigned a local project.
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-2 max-h-80 overflow-y-auto py-1">
        <p v-if="loadingJiraProjects" class="text-xs text-muted-foreground">Loading boards…</p>
        <p v-else-if="dialogSelections.length === 0" class="text-xs text-muted-foreground">
          All available boards are already imported.
        </p>
        <div
          v-for="sel in dialogSelections"
          :key="sel.jiraProject.key"
          class="grid grid-cols-[auto_1fr_1fr] gap-2 items-center"
        >
          <input
            v-model="sel.selected"
            type="checkbox"
            class="rounded"
          />
          <span class="text-sm font-mono truncate">
            {{ sel.jiraProject.key }}{{ sel.jiraProject.name !== sel.jiraProject.key ? ` — ${sel.jiraProject.name}` : '' }}
          </span>
          <select
            v-model="sel.projectPath"
            :disabled="!sel.selected"
            class="bg-background border border-border rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full disabled:opacity-40"
          >
            <option value="">— select project —</option>
            <option v-for="p in projects" :key="p.path" :value="p.path">{{ p.name }}</option>
          </select>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="ghost" @click="dialogOpen = false">Cancel</Button>
        <Button type="button" :disabled="!canImport()" @click="importBoards">Import</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
