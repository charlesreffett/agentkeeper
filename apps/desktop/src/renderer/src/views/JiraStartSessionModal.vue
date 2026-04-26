<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { useProjectsStore } from '@/stores/projects'
import { useSessionStore } from '@/stores/sessions'
import { useJiraActivityStore } from '@/stores/jiraActivity'
import type { Agency, Role, RoleEffort, WorkItem } from '@shared/ipc-contract'
import { ROLE_EFFORT_VALUES } from '@shared/ipc-contract'

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
const projectsStore = useProjectsStore()
const sessionStore = useSessionStore()
const activityStore = useJiraActivityStore()

// Solo fields
const prompt = ref('')
const model = ref('claude-sonnet-4-6')
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

const starting = ref(false)
const startError = ref<string | null>(null)

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

const focusedProject = computed(() => projectsStore.focusedProject)

const defaultPrompt = computed(
  () => `Work on ${props.item.externalRef}: ${props.item.title}`,
)

async function loadRoles(projectPath: string) {
  try {
    roles.value = await window.orchestral.roles.list(projectPath)
  } catch {
    roles.value = []
  }
}

async function loadAgencies(projectPath: string) {
  try {
    agencies.value = await window.orchestral.agencies.list(projectPath)
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
      model.value = 'claude-sonnet-4-6'
      effort.value = 'medium'
      useWorktree.value = false
      branch.value = ''
      agencyUseWorktree.value = false
      agencyBranch.value = ''
      selectedRoleId.value = ''
      selectedAgencyId.value = ''
      starting.value = false
      startError.value = null
      if (focusedProject.value) {
        await Promise.all([
          loadRoles(focusedProject.value.path),
          loadAgencies(focusedProject.value.path),
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

async function startSolo() {
  const proj = focusedProject.value
  if (!proj) return
  starting.value = true
  startError.value = null
  try {
    const selectedRole = roles.value.find((r) => r.id === selectedRoleId.value) ?? null
    let worktreePath: string | undefined
    let resolvedBranch: string | undefined
    if (useWorktree.value && branch.value.trim()) {
      const wt = await window.orchestral.worktrees.create(proj.path, branch.value.trim())
      worktreePath = wt.path
      resolvedBranch = wt.branch
    }
    await sessionStore.start({
      projectPath: proj.path,
      workItemId: props.item.id,
      initialPrompt: prompt.value.trim(),
      model: model.value,
      effort: effort.value,
      ...(worktreePath ? { worktreePath } : {}),
      ...(resolvedBranch ? { branch: resolvedBranch } : {}),
      ...(selectedRole?.name ? { roleName: selectedRole.name } : {}),
      ...(selectedRole?.systemPrompt ? { systemPromptAppend: selectedRole.systemPrompt } : {}),
      ...(selectedRole?.allowedTools?.length ? { allowedTools: selectedRole.allowedTools } : {}),
    })
    activityStore.addEntry(props.item.id, 'claude', 'Claude opened session')
    emit('started')
    emit('close')
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err)
  } finally {
    starting.value = false
  }
}

async function startAgency() {
  const proj = focusedProject.value
  if (!proj || !selectedAgencyId.value) return
  starting.value = true
  startError.value = null
  try {
    const ag = agencies.value.find((a) => a.id === selectedAgencyId.value)
    if (!ag) throw new Error('Agency not found')
    let worktreePath: string | undefined
    let resolvedBranch: string | undefined
    if (agencyUseWorktree.value && agencyBranch.value.trim()) {
      const wt = await window.orchestral.worktrees.create(proj.path, agencyBranch.value.trim())
      worktreePath = wt.path
      resolvedBranch = wt.branch
    }
    await window.orchestral.agencies.start({
      projectPath: proj.path,
      agencyId: selectedAgencyId.value,
      agencyScope: ag.scope,
      initialPrompt: agencyPrompt.value.trim(),
      useWorktree: agencyUseWorktree.value,
      branch: resolvedBranch,
    })
    activityStore.addEntry(props.item.id, 'claude', 'Claude opened agency session')
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
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-lg w-full shadow-xl"
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

      <!-- Project status banner -->
      <div
        v-if="!focusedProject"
        class="px-4 py-2 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-b border-amber-500/30"
      >
        No project focused — select one in the sidebar.
      </div>
      <div v-else class="px-4 py-2 text-xs text-muted-foreground border-b border-border">
        Project: <span class="font-medium text-foreground">{{ focusedProject.name }}</span>
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
              class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring"
            >
              <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium">Effort</label>
          <select
            v-model="effort"
            class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:border-ring"
          >
            <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">{{ e }}</option>
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
            :disabled="starting || !focusedProject || !prompt.trim()"
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
            :disabled="starting || !focusedProject || !selectedAgencyId || !agencyPrompt.trim()"
          >
            {{ starting ? 'Starting…' : 'Start agency' }}
          </Button>
        </div>
      </form>
    </div>
  </dialog>
</template>
