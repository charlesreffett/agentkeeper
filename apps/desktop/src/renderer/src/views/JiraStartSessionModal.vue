<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/sessions'
import { useJiraActivityStore } from '@/stores/jiraActivity'
import type { Agency, Role, RoleEffort, WorkItem } from '@shared/ipc-contract'
import { useModelsQuery } from '@/composables/useModelsQuery'

const props = defineProps<{
  open: boolean
  item: WorkItem
}>()

const emit = defineEmits<{
  close: []
  started: []
}>()

type Mode = 'solo' | 'agency'

const dialog = ref<HTMLDialogElement | null>(null)
const mode = ref<Mode>('solo')
const sessionStore = useSessionStore()
const activityStore = useJiraActivityStore()

// Solo fields
const prompt = ref('')
const model = ref('')
const effort = ref<RoleEffort>('medium')
const useWorktree = ref(false)
const branch = ref('')
const roles = ref<Role[]>([])
const selectedRoleId = ref('')

// Agency fields
const agencies = ref<Agency[]>([])
const selectedAgencyId = ref('')
const agencyPrompt = ref('')
const agencyUseWorktree = ref(false)
const agencyBranch = ref('')

const projects = ref<Array<{ path: string; name: string; repo: string | null; lastOpenedAt: number }>>([])
const jiraConfig = ref<{ projectMappings?: Array<{ jiraProjectKey: string; projectPath: string }>; projectKey?: string } | null>(null)
const selectedProjectPath = ref('')

const starting = ref(false)
const startError = ref<string | null>(null)

const { models: availableModels, optionsFor: modelOptionsFor, effortLevelsFor, defaultValue: defaultModel, error: modelsError, isEmpty: noModels } = useModelsQuery()
// Seed to the harness default; also redirect a stale/unavailable seed value.
watch([availableModels, defaultModel], () => {
  if (!availableModels.value.length) return
  if (!model.value || !availableModels.value.some((m) => m.value === model.value)) {
    model.value = defaultModel.value
  }
}, { immediate: true })

const defaultPrompt = computed(
  () => `Work on ${props.item.externalRef}: ${props.item.title}`,
)

function detectProjectPath(): string {
  const match = props.item.externalRef?.match(/^([A-Z]+)-\d+$/)
  const prefix = match?.[1]
  if (prefix && jiraConfig.value?.projectMappings) {
    const mapping = jiraConfig.value.projectMappings.find(
      (m) => m.jiraProjectKey === prefix,
    )
    if (mapping?.projectPath) return mapping.projectPath
  }
  return ''
}

const isMappedProject = computed(() => {
  const match = props.item.externalRef?.match(/^([A-Z]+)-\d+$/)
  const prefix = match?.[1]
  return !!(prefix && jiraConfig.value?.projectMappings?.some((m) => m.jiraProjectKey === prefix && m.projectPath))
})

async function loadRoles(projectPath: string) {
  try {
    roles.value = await window.agentkeeper.roles.list(projectPath)
  } catch {
    roles.value = []
  }
}

async function loadAgencies(projectPath: string) {
  try {
    agencies.value = await window.agentkeeper.agencies.list(projectPath)
  } catch {
    agencies.value = []
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      mode.value = 'solo'
      prompt.value = defaultPrompt.value
      agencyPrompt.value = defaultPrompt.value
      model.value = 'default'
      effort.value = 'medium'
      useWorktree.value = false
      branch.value = ''
      agencyUseWorktree.value = false
      agencyBranch.value = ''
      selectedRoleId.value = ''
      selectedAgencyId.value = ''
      starting.value = false
      startError.value = null

      const projectsList = await window.agentkeeper.projects.list()
      projects.value = projectsList

      const jiraCfg = (await window.agentkeeper.plugins.getConfig('jira')) as {
        projectMappings?: Array<{ jiraProjectKey: string; projectPath: string }>
        projectKey?: string
      } | null
      jiraConfig.value = jiraCfg

      selectedProjectPath.value = detectProjectPath()

      if (selectedProjectPath.value) {
        await Promise.all([
          loadRoles(selectedProjectPath.value),
          loadAgencies(selectedProjectPath.value),
        ])
        if (agencies.value.length > 0) selectedAgencyId.value = agencies.value[0]!.id
      }
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

async function onProjectChanged() {
  if (selectedProjectPath.value) {
    await Promise.all([
      loadRoles(selectedProjectPath.value),
      loadAgencies(selectedProjectPath.value),
    ])
    if (agencies.value.length > 0) selectedAgencyId.value = agencies.value[0]!.id
    else selectedAgencyId.value = ''
  }
}

async function startSolo() {
  if (!selectedProjectPath.value) return
  starting.value = true
  startError.value = null
  try {
    const selectedRole = roles.value.find((r) => r.id === selectedRoleId.value) ?? null
    let worktreePath: string | undefined
    let resolvedBranch: string | undefined
    if (useWorktree.value && branch.value.trim()) {
      const wt = await window.agentkeeper.worktrees.create(selectedProjectPath.value, branch.value.trim())
      worktreePath = wt.path
      resolvedBranch = wt.branch
    }
    await sessionStore.start({
      projectPath: selectedProjectPath.value,
      workItemId: props.item.id,
      workItemKey: props.item.externalRef ?? null,
      workItemTitle: props.item.title ?? null,
      initialPrompt: prompt.value.trim(),
      model: model.value,
      effort: effort.value,
      ...(worktreePath ? { worktreePath } : {}),
      ...(resolvedBranch ? { branch: resolvedBranch } : {}),
      ...(selectedRole?.name ? { roleName: selectedRole.name } : {}),
      ...(selectedRole?.systemPrompt ? { systemPromptAppend: selectedRole.systemPrompt } : {}),
    })
    await activityStore.addEntry(props.item.externalRef, 'claude', 'Claude opened session')
    emit('started')
    emit('close')
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err)
  } finally {
    starting.value = false
  }
}

async function startAgency() {
  if (!selectedProjectPath.value || !selectedAgencyId.value) return
  starting.value = true
  startError.value = null
  try {
    const ag = agencies.value.find((a) => a.id === selectedAgencyId.value)
    if (!ag) throw new Error('Agency not found')
    let worktreePath: string | undefined
    let resolvedBranch: string | undefined
    if (agencyUseWorktree.value && agencyBranch.value.trim()) {
      const wt = await window.agentkeeper.worktrees.create(selectedProjectPath.value, agencyBranch.value.trim())
      worktreePath = wt.path
      resolvedBranch = wt.branch
    }
    await window.agentkeeper.agencies.start({
      projectPath: selectedProjectPath.value,
      agencyId: selectedAgencyId.value,
      agencyScope: ag.scope,
      initialPrompt: agencyPrompt.value.trim(),
      useWorktree: agencyUseWorktree.value,
      branch: resolvedBranch,
      workItemKey: props.item.externalRef ?? null,
      workItemTitle: props.item.title ?? null,
    })
    await activityStore.addEntry(props.item.externalRef, 'claude', 'Claude opened agency session')
    emit('started')
    emit('close')
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-popover text-foreground border border-popover-border backdrop:bg-black/25 backdrop:backdrop-blur-md max-w-lg w-full shadow-dialog"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <div class="flex items-center gap-1 text-sm font-semibold">
          <span>Start session</span>
          <span class="ml-1 text-xs font-mono text-muted-foreground">{{ item.externalRef }}</span>
        </div>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <!-- Mode toggle -->
      <div class="flex border-b border-border">
        <button
          class="flex-1 py-2 text-xs font-medium transition-colors"
          :class="mode === 'solo' ? 'bg-muted/40 text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="mode = 'solo'"
        >
          Solo session
        </button>
        <button
          class="flex-1 py-2 text-xs font-medium transition-colors"
          :class="mode === 'agency' ? 'bg-muted/40 text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="mode = 'agency'"
        >
          Agency
        </button>
      </div>

      <!-- Project selection -->
      <div class="px-4 py-2 border-b border-border space-y-1">
        <label class="text-xs font-medium">Project</label>
        <select
          v-model="selectedProjectPath"
          class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring"
          @change="onProjectChanged"
        >
          <option value="">Select project…</option>
          <option v-for="p in projects" :key="p.path" :value="p.path">{{ p.name }}</option>
        </select>
        <p v-if="isMappedProject && selectedProjectPath" class="text-xs text-muted-foreground">
          Auto-selected from Jira mapping
        </p>
        <p v-else-if="!selectedProjectPath" class="text-xs text-amber-600 dark:text-amber-400">
          No project selected — add one in the sidebar or configure Jira mappings.
        </p>
      </div>

      <!-- Solo mode -->
      <form v-if="mode === 'solo'" class="p-4 space-y-3" @submit.prevent="startSolo">
        <div class="space-y-1.5">
          <label class="text-xs font-medium">Initial prompt</label>
          <textarea
            v-model="prompt"
            rows="4"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-none"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <label class="text-xs font-medium">Role</label>
            <select
              v-model="selectedRoleId"
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring"
            >
              <option value="">Freeform</option>
              <option v-for="r in roles" :key="r.id" :value="r.id">{{ r.name }}</option>
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium">Model</label>
            <select
              v-model="model"
              :disabled="noModels"
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring disabled:opacity-50"
            >
              <option v-for="m in modelOptionsFor(model)" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
            <p v-if="modelsError" class="text-xs text-destructive">Harness unavailable — no models.</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium">Effort</label>
          <select
            v-model="effort"
            class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring"
          >
            <option v-for="e in effortLevelsFor(model)" :key="e" :value="e">{{ e }}</option>
          </select>
        </div>

        <div class="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input v-model="useWorktree" type="checkbox" class="size-4 rounded border-input" />
            <span class="text-xs font-medium">Create git worktree</span>
          </label>
          <div v-if="useWorktree" class="pl-6 space-y-1">
            <label class="text-xs text-muted-foreground">Branch name</label>
            <input
              v-model="branch"
              type="text"
              placeholder="e.g. fix-core-21"
              class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring font-mono"
            />
          </div>
        </div>

        <div v-if="startError" class="text-xs text-destructive">{{ startError }}</div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
          <Button
            type="submit"
            size="sm"
            :disabled="starting || !selectedProjectPath || !prompt.trim()"
          >
            {{ starting ? 'Starting…' : 'Start session' }}
          </Button>
        </div>
      </form>

      <!-- Agency mode -->
      <form v-else class="p-4 space-y-3" @submit.prevent="startAgency">
        <div class="space-y-1.5">
          <label class="text-xs font-medium">Agency</label>
          <select
            v-model="selectedAgencyId"
            class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring"
          >
            <option v-if="agencies.length === 0" value="" disabled>No agencies found</option>
            <option v-for="a in agencies" :key="a.id" :value="a.id">{{ a.name }}</option>
          </select>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium">Initial prompt</label>
          <textarea
            v-model="agencyPrompt"
            rows="4"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-none"
          />
        </div>

        <div class="space-y-2 rounded-md border border-border bg-muted/20 p-3">
          <label class="flex items-center gap-2 cursor-pointer select-none">
            <input v-model="agencyUseWorktree" type="checkbox" class="size-4 rounded border-input" />
            <span class="text-xs font-medium">Create git worktree</span>
          </label>
          <div v-if="agencyUseWorktree" class="pl-6 space-y-1">
            <label class="text-xs text-muted-foreground">Branch name</label>
            <input
              v-model="agencyBranch"
              type="text"
              placeholder="e.g. fix-core-21"
              class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring font-mono"
            />
          </div>
        </div>

        <div v-if="startError" class="text-xs text-destructive">{{ startError }}</div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
          <Button
            type="submit"
            size="sm"
            :disabled="starting || !selectedProjectPath || !selectedAgencyId || !agencyPrompt.trim()"
          >
            {{ starting ? 'Starting…' : 'Start agency' }}
          </Button>
        </div>
      </form>
    </div>
  </dialog>
</template>
