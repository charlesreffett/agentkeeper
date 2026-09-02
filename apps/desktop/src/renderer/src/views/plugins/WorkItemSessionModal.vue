<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Agency, RecentProject, RoleEffort, WorkItem } from '@shared/ipc-contract'
import { useSessionStore } from '@/stores/sessions'
import { useModelsQuery } from '@/composables/useModelsQuery'
import { useHarnessCapabilities } from '@/composables/useHarnessCapabilities'
import { defaultModelFor } from '@/composables/useModelMemory'
import { Button } from '@/components/ui/button'
import ExecutionTargetPicker from '@/components/ExecutionTargetPicker.vue'

const props = defineProps<{
  open: boolean
  sourceId: string
  item: WorkItem | null
  suggestedProjectPath?: string
}>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const projectPath = ref('')
const projects = ref<RecentProject[]>([])
const agencies = ref<Agency[]>([])
const agencyKey = ref('')
const prompt = ref('')
const model = ref('')
const harnessId = ref<string | undefined>()
const effort = ref<RoleEffort>('medium')
const useWorktree = ref(false)
const branch = ref('')
const starting = ref(false)
const error = ref('')
const router = useRouter()
const sessions = useSessionStore()
const { models, effortLevelsFor, defaultValue, error: modelsError } = useModelsQuery(() => harnessId.value)
const { agenciesCapable } = useHarnessCapabilities()
const isAgency = computed(() => Boolean(agencyKey.value))
const agencySupported = computed(() => agenciesCapable(harnessId.value))

const reference = computed(() => props.item ? {
  sourceId: props.sourceId,
  itemId: props.item.id,
  externalRef: props.item.externalRef,
  title: props.item.title,
} : null)

watch([models, defaultValue], () => {
  if (models.value.length && !models.value.some(option => option.value === model.value)) model.value = defaultValue.value
}, { immediate: true })

watch([model, () => harnessId.value], () => {
  const levels = effortLevelsFor(model.value)
  if (!levels.includes(effort.value)) effort.value = levels[0] ?? 'medium'
})

async function loadProjectOptions(): Promise<void> {
  agencies.value = projectPath.value
    ? await window.agentkeeper.agencies.list(projectPath.value).catch(() => [])
    : []
  if (!agencies.value.some(agency => `${agency.scope}:${agency.id}` === agencyKey.value)) agencyKey.value = ''
}

watch(() => props.open, async open => {
  if (!open || !props.item) { dialog.value?.close(); return }
  const settings = await window.agentkeeper.settings.get()
  agencyKey.value = ''; prompt.value = `Work on ${props.item.externalRef}: ${props.item.title}`; harnessId.value = settings.harnessId; model.value = defaultModelFor(settings, settings.harnessId); effort.value = settings.defaultEffort; useWorktree.value = settings.defaultUseWorktree; branch.value = ''; error.value = ''
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
    if (isAgency.value) {
      const agency = agencies.value.find(candidate => `${candidate.scope}:${candidate.id}` === agencyKey.value)
      if (!agency) throw new Error('Select an agency')
      const instance = await window.agentkeeper.agencies.start({ projectPath: projectPath.value, agencyId: agency.id, agencyScope: agency.scope, initialPrompt: prompt.value.trim(), useWorktree: useWorktree.value, branch: branch.value.trim() || undefined, model: model.value, harnessId: harnessId.value, workItem: reference.value })
      emit('close')
      await router.push(`/sessions/${instance.instanceId}`)
      return
    }
    const wt = await worktree()
    const localId = await sessions.start({ projectPath: projectPath.value, worktreePath: wt.path, branch: wt.branch, initialPrompt: prompt.value.trim(), model: model.value, harnessId: harnessId.value, effort: effort.value, workItem: reference.value })
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
      <div class="space-y-3 p-4">
        <label class="block space-y-1"><span class="text-xs font-medium">Project</span><select v-model="projectPath" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" @change="loadProjectOptions"><option value="">Select project…</option><option v-for="project in projects" :key="project.path" :value="project.path">{{ project.name }}</option></select></label>
        <label class="block space-y-1"><span class="text-xs font-medium">Model or agency</span><ExecutionTargetPicker v-model="model" v-model:harness-id="harnessId" v-model:agency-key="agencyKey" :agencies="agencies" allow-agencies harness-switchable display="field" /></label>
        <label class="block space-y-1"><span class="text-xs font-medium">Initial prompt</span><textarea v-model="prompt" rows="4" class="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
        <label v-if="!isAgency" class="block space-y-1"><span class="text-xs font-medium">Effort</span><select v-model="effort" class="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"><option v-for="level in effortLevelsFor(model)" :key="level">{{ level }}</option></select></label>
        <p v-if="modelsError" class="text-xs text-destructive">Harness models are unavailable.</p>
        <p v-if="isAgency && !agencySupported" class="text-xs text-destructive">The selected harness cannot run agencies. Choose an agency-capable harness from the Models tab first.</p>
        <div class="space-y-2 rounded-md border border-border bg-muted/20 p-3"><label class="flex items-center gap-2 text-xs font-medium"><input v-model="useWorktree" type="checkbox" /> Create git worktree</label><input v-if="useWorktree" v-model="branch" class="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-sm" placeholder="Branch name" /></div>
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>
      <footer class="flex justify-end gap-2 border-t border-border px-4 py-3"><Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button><Button type="submit" size="sm" :disabled="starting || !projectPath || !prompt.trim() || (isAgency && !agencySupported)">{{ starting ? 'Starting…' : isAgency ? 'Start agency' : 'Start session' }}</Button></footer>
    </form>
  </dialog>
</template>
