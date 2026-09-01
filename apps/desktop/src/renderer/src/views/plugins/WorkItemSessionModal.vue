<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Agency, RecentProject, Role, RoleEffort, WorkItem } from '@shared/ipc-contract'
import { useSessionStore } from '@/stores/sessions'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { useHarnessCapabilities } from '@/composables/useHarnessCapabilities'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  open: boolean
  sourceId: string
  item: WorkItem | null
  suggestedProjectPath?: string
}>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const mode = ref<'solo' | 'agency'>('solo')
const projectPath = ref('')
const projects = ref<RecentProject[]>([])
const roles = ref<Role[]>([])
const agencies = ref<Agency[]>([])
const roleId = ref('')
const agencyId = ref('')
const prompt = ref('')
const model = ref('default')
const effort = ref<RoleEffort>('medium')
const useWorktree = ref(false)
const branch = ref('')
const starting = ref(false)
const error = ref('')
const router = useRouter()
const sessions = useSessionStore()
const { models, optionsFor, effortLevelsFor, defaultValue, error: modelsError, isEmpty: noModels } = useModelsQuery()
const { agenciesCapable } = useHarnessCapabilities()

const reference = computed(() => props.item ? {
  sourceId: props.sourceId,
  itemId: props.item.id,
  externalRef: props.item.externalRef,
  title: props.item.title,
} : null)

watch([models, defaultValue], () => {
  if (models.value.length && !models.value.some(option => option.value === model.value)) model.value = defaultValue.value
}, { immediate: true })

async function loadProjectOptions(): Promise<void> {
  if (!projectPath.value) { roles.value = []; agencies.value = []; return }
  ;[roles.value, agencies.value] = await Promise.all([
    window.agentkeeper.roles.list(projectPath.value).catch(() => []),
    window.agentkeeper.agencies.list(projectPath.value).catch(() => []),
  ])
  roleId.value = ''
  agencyId.value = agencies.value[0]?.id ?? ''
}

watch(() => props.open, async open => {
  if (!open || !props.item) { dialog.value?.close(); return }
  mode.value = 'solo'; prompt.value = `Work on ${props.item.externalRef}: ${props.item.title}`; model.value = 'default'; effort.value = 'medium'; useWorktree.value = false; branch.value = ''; error.value = ''
  projects.value = await window.agentkeeper.projects.list()
  projectPath.value = projects.value.some(project => project.path === props.suggestedProjectPath) ? props.suggestedProjectPath! : ''
  await loadProjectOptions(); await nextTick(); dialog.value?.showModal()
})

async function worktree(): Promise<{ path?: string; branch?: string }> {
  if (!useWorktree.value) return {}
  if (!branch.value.trim()) throw new Error('Enter a branch name for the worktree')
  const created = await window.agentkeeper.worktrees.create(projectPath.value, { branchRequest: branch.value.trim() })
  return { path: created.path, branch: created.branch }
}

async function start(): Promise<void> {
  if (!props.item || !reference.value || !projectPath.value || !prompt.value.trim()) return
  starting.value = true; error.value = ''
  try {
    const wt = await worktree()
    if (mode.value === 'agency') {
      const agency = agencies.value.find(candidate => candidate.id === agencyId.value)
      if (!agency) throw new Error('Select an agency')
      await window.agentkeeper.agencies.start({ projectPath: projectPath.value, agencyId: agency.id, agencyScope: agency.scope, initialPrompt: prompt.value.trim(), useWorktree: useWorktree.value, branch: wt.branch, model: model.value, workItem: reference.value })
      emit('close')
      return
    }
    const role = roles.value.find(candidate => candidate.id === roleId.value)
    const localId = await sessions.start({ projectPath: projectPath.value, worktreePath: wt.path, branch: wt.branch, initialPrompt: prompt.value.trim(), model: model.value, effort: effort.value, workItem: reference.value, roleId: role?.id, roleName: role?.name, systemPromptAppend: role?.systemPrompt })
    emit('close'); await router.push(`/sessions/${localId}`)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { starting.value = false }
}
</script>

<template>
  <dialog ref="dialog" class="w-full max-w-lg rounded-lg border border-popover-border bg-popover p-0 text-foreground shadow-dialog backdrop:bg-black/30 backdrop:backdrop-blur-sm" @cancel.prevent="emit('close')" @close="emit('close')">
    <form class="flex flex-col" @submit.prevent="start">
      <header class="flex items-center justify-between border-b border-border px-4 py-3">
        <div><span class="text-sm font-semibold">Start session</span><span class="ml-2 font-mono text-xs text-muted-foreground">{{ item?.externalRef }}</span></div>
        <button type="button" class="text-lg text-muted-foreground hover:text-foreground" @click="emit('close')">×</button>
      </header>
      <div class="flex border-b border-border">
        <button v-for="option in ['solo', 'agency'] as const" :key="option" type="button" class="flex-1 py-2 text-xs font-medium capitalize" :class="mode === option ? 'bg-muted/40 text-foreground' : 'text-muted-foreground'" @click="mode = option">{{ option }}</button>
      </div>
      <div class="space-y-3 p-4">
        <label class="block space-y-1"><span class="text-xs font-medium">Project</span><select v-model="projectPath" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" @change="loadProjectOptions"><option value="">Select project…</option><option v-for="project in projects" :key="project.path" :value="project.path">{{ project.name }}</option></select></label>
        <label v-if="mode === 'solo'" class="block space-y-1"><span class="text-xs font-medium">Role</span><select v-model="roleId" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"><option value="">Freeform</option><option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option></select></label>
        <label v-else class="block space-y-1"><span class="text-xs font-medium">Agency</span><select v-model="agencyId" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"><option value="">Select agency…</option><option v-for="agency in agencies" :key="agency.id" :value="agency.id">{{ agency.name }}</option></select></label>
        <label class="block space-y-1"><span class="text-xs font-medium">Initial prompt</span><textarea v-model="prompt" rows="4" class="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
        <div class="grid grid-cols-2 gap-3"><label class="space-y-1"><span class="text-xs font-medium">Model</span><select v-model="model" :disabled="noModels" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"><option v-for="option in optionsFor(model)" :key="option.value" :value="option.value">{{ option.label }}</option></select></label><label v-if="mode === 'solo'" class="space-y-1"><span class="text-xs font-medium">Effort</span><select v-model="effort" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"><option v-for="level in effortLevelsFor(model)" :key="level">{{ level }}</option></select></label></div>
        <p v-if="modelsError" class="text-xs text-destructive">Harness models are unavailable.</p>
        <div class="space-y-2 rounded-md border border-border bg-muted/20 p-3"><label class="flex items-center gap-2 text-xs font-medium"><input v-model="useWorktree" type="checkbox" /> Create git worktree</label><input v-if="useWorktree" v-model="branch" class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm" placeholder="Branch name" /></div>
        <p v-if="mode === 'agency' && !agenciesCapable" class="text-xs text-destructive">The active harness cannot run agencies.</p>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>
      <footer class="flex justify-end gap-2 border-t border-border px-4 py-3"><Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button><Button type="submit" size="sm" :disabled="starting || !projectPath || !prompt.trim() || (mode === 'agency' && (!agencyId || !agenciesCapable))">{{ starting ? 'Starting…' : mode === 'agency' ? 'Start agency' : 'Start session' }}</Button></footer>
    </form>
  </dialog>
</template>
