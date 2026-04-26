<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRaw, watch } from 'vue'
import { Button } from '@/components/ui/button'
import ProjectPicker from '@/components/ProjectPicker.vue'
import CommandAutocomplete from '@/components/CommandAutocomplete.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsStore } from '@/stores/projects'
import { useCommandAutocomplete } from '@/composables/useCommandAutocomplete'
import {
  ROLE_EFFORT_VALUES,
  type Agency,
  type RecentProject,
  type Role,
  type RoleEffort,
} from '@shared/ipc-contract'

const props = defineProps<{
  open: boolean
  projectPath?: string
  defaultModel: string
  defaultEffort: RoleEffort
  defaultUseWorktree: boolean
}>()

const emit = defineEmits<{
  close: []
  start: [
    params: {
      projectPath: string
      initialPrompt: string
      model: string
      effort: RoleEffort
      useWorktree: boolean
      branch: string
      role: Role | null
    },
  ]
}>()

const projectsStore = useProjectsStore()
const sessionsStore = useSessionStore()

const dialog = ref<HTMLDialogElement | null>(null)
const prompt = ref('')
const model = ref(props.defaultModel)
const textarea = ref<HTMLTextAreaElement | null>(null)

const useWorktree = ref(props.defaultUseWorktree)
const branch = ref('')
const branchTouched = ref(false)

const effort = ref<RoleEffort>(props.defaultEffort)
const effortTouched = ref(false)

const roles = ref<Role[]>([])
const selectedRoleId = ref<string>('')

const agencies = ref<Agency[]>([])
const selectedAgencyKey = ref<string>('')

const selectedAgency = computed<Agency | null>(() =>
  selectedAgencyKey.value
    ? (agencies.value.find((a) => `${a.scope}:${a.id}` === selectedAgencyKey.value) ?? null)
    : null,
)

const starting = ref(false)
const startError = ref<string | null>(null)

const selectedProject = ref<RecentProject | null>(null)
const pickerOpen = ref(false)

const projectPathRef = computed(() => selectedProject.value?.path ?? '')
const ac = useCommandAutocomplete(prompt, projectPathRef)

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

const selectedRole = computed<Role | null>(() =>
  selectedRoleId.value
    ? (roles.value.find((r) => r.id === selectedRoleId.value) ?? null)
    : null,
)

function resolveDefaultProject(): RecentProject | null {
  if (projectsStore.focusedProject) return projectsStore.focusedProject
  if (props.projectPath) {
    return projectsStore.projects.find((p) => p.path === props.projectPath) ?? null
  }
  return null
}

async function loadRoles() {
  const path = selectedProject.value?.path ?? props.projectPath ?? ''
  if (!path) {
    roles.value = []
    return
  }
  try {
    roles.value = await window.orchestral.roles.list(path)
  } catch {
    roles.value = []
  }
}

async function loadAgencies() {
  const path = selectedProject.value?.path ?? props.projectPath ?? ''
  if (!path) {
    agencies.value = []
    return
  }
  try {
    agencies.value = await window.orchestral.agencies.list(path)
  } catch {
    agencies.value = []
  }
}

watch(selectedProject, () => {
  void loadRoles()
  void loadAgencies()
})

const suggestedBranch = computed(() => {
  const raw = prompt.value.trim().split(/\s+/).slice(0, 6).join(' ')
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9./-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '')
    .slice(0, 60)
})

watch(suggestedBranch, (v) => {
  if (!branchTouched.value) branch.value = v
})

watch(selectedRole, (r) => {
  if (r?.model) model.value = r.model
  if (!effortTouched.value) {
    effort.value = r?.effort ?? props.defaultEffort
  }
})

function onEffortChange(event: Event) {
  effortTouched.value = true
  effort.value = (event.target as HTMLSelectElement).value as RoleEffort
}

function onBranchInput(event: Event) {
  branchTouched.value = true
  branch.value = (event.target as HTMLInputElement).value
}

const canStart = computed(() => {
  if (!selectedProject.value) return false
  if (!prompt.value.trim()) return false
  if (useWorktree.value && !branch.value.trim()) return false
  return true
})

async function start() {
  if (!canStart.value || !selectedProject.value) return
  startError.value = null
  if (selectedAgency.value) {
    starting.value = true
    try {
      const instance = await window.orchestral.agencies.start({
        projectPath: selectedProject.value.path,
        agencyId: selectedAgency.value.id,
        agencyScope: selectedAgency.value.scope,
        initialPrompt: prompt.value.trim(),
        useWorktree: useWorktree.value,
        ...(useWorktree.value && branch.value.trim() ? { branch: branch.value.trim() } : {}),
        model: model.value || undefined,
      })
      for (const s of instance.sessions) {
        const role = roles.value.find((r) => r.id === s.roleId)
        sessionsStore.registerExternal({
          localId: s.localId,
          projectPath: instance.projectPath,
          worktreePath: instance.worktreePath,
          branch: instance.branch,
          roleName: s.roleName,
          agencyInstanceId: instance.instanceId,
          agencyName: instance.agencyName,
          initialPrompt: s.isEntryPoint ? prompt.value.trim() : '(awaiting peers)',
          model: role?.model ?? model.value,
        })
      }
      emit('close')
    } catch (e) {
      startError.value = e instanceof Error ? e.message : String(e)
    } finally {
      starting.value = false
    }
  } else {
    emit('start', {
      projectPath: selectedProject.value.path,
      initialPrompt: prompt.value.trim(),
      model: model.value,
      effort: effort.value,
      useWorktree: useWorktree.value,
      branch: branch.value.trim(),
      role: selectedRole.value ? { ...toRaw(selectedRole.value) } : null,
    })
  }
}

function onKeyDown(event: KeyboardEvent) {
  if (ac.isOpen.value) {
    if (event.key === 'ArrowUp') { event.preventDefault(); ac.moveUp(); return }
    if (event.key === 'ArrowDown') { event.preventDefault(); ac.moveDown(); return }
    if (event.key === 'Escape') { event.preventDefault(); ac.close(); return }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      const cmd = ac.selectIndex(ac.selectedIndex.value)
      if (cmd) {
        event.preventDefault()
        prompt.value = ac.resolveBody(cmd)
        ac.close()
        void start()
        return
      }
      ac.close()
    }
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    void start()
  }
}

function onPickerConfirm(project: RecentProject) {
  selectedProject.value = project
  pickerOpen.value = false
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      prompt.value = ''
      branch.value = ''
      branchTouched.value = false
      model.value = props.defaultModel
      effort.value = props.defaultEffort
      effortTouched.value = false
      useWorktree.value = props.defaultUseWorktree
      selectedRoleId.value = ''
      selectedAgencyKey.value = ''
      startError.value = null
      selectedProject.value = resolveDefaultProject()
      await Promise.all([loadRoles(), loadAgencies()])
      await nextTick()
      dialog.value?.showModal()
      textarea.value?.focus()
    } else {
      dialog.value?.close()
    }
  },
)

onMounted(() => {
  if (props.open) {
    void nextTick(async () => {
      selectedProject.value = resolveDefaultProject()
      await Promise.all([loadRoles(), loadAgencies()])
      dialog.value?.showModal()
      textarea.value?.focus()
    })
  }
})
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-2xl w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="p-6 space-y-4">
      <header class="space-y-1">
        <h2 class="text-lg font-semibold">New session</h2>
      </header>

      <!-- Project selector -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium">Project</label>
        <button
          class="w-full text-left rounded-md border px-3 py-2 text-sm transition-colors"
          :class="
            selectedProject
              ? 'border-input bg-background hover:border-ring'
              : 'border-amber-500/60 bg-amber-500/5 hover:border-amber-500'
          "
          @click="pickerOpen = true"
        >
          <span v-if="selectedProject" class="font-medium">{{ selectedProject.name }}</span>
          <span v-else class="text-muted-foreground">Select a project…</span>
          <span v-if="selectedProject" class="ml-2 text-xs text-muted-foreground font-mono">
            {{ selectedProject.repo ?? selectedProject.path }}
          </span>
        </button>
      </div>

      <div class="space-y-2">
        <label class="text-sm font-medium">Initial prompt</label>
        <div class="relative">
          <CommandAutocomplete
            v-if="ac.isOpen.value"
            :suggestions="ac.suggestions.value"
            :selected-index="ac.selectedIndex.value"
            @select="(cmd) => { prompt = ac.resolveBody(cmd); ac.close(); void start() }"
            @close="ac.close()"
          />
          <textarea
            ref="textarea"
            v-model="prompt"
            rows="8"
            placeholder="What do you want to work on?"
            class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-ring font-sans resize-none"
            @keydown="onKeyDown"
          />
        </div>
      </div>

      <div class="space-y-3 rounded-md border border-border bg-muted/20 p-3">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            v-model="useWorktree"
            type="checkbox"
            class="size-4 rounded border-input"
          />
          <span class="text-sm font-medium">
            Create a git worktree for this session
          </span>
        </label>
        <p class="text-xs text-muted-foreground leading-relaxed pl-6">
          Isolates this session to its own branch so parallel sessions don't
          step on each other.
        </p>
        <div v-if="useWorktree" class="space-y-1.5 pl-6">
          <label class="text-xs text-muted-foreground">Branch name</label>
          <input
            :value="branch"
            type="text"
            placeholder="e.g. add-login-page"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
            @input="onBranchInput"
          />
        </div>
      </div>

      <!-- Agency selector -->
      <div class="space-y-1.5">
        <label class="text-sm font-medium">
          Agency
          <span class="text-muted-foreground font-normal text-xs">(optional)</span>
        </label>
        <select
          v-model="selectedAgencyKey"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        >
          <option value="">None — plain session</option>
          <option
            v-for="a in agencies"
            :key="`${a.scope}:${a.id}`"
            :value="`${a.scope}:${a.id}`"
          >
            {{ a.name }}
            <template v-if="a.scope === 'global'"> (global)</template>
          </option>
        </select>
      </div>

      <!-- Role + Model row -->
      <div class="grid gap-3" :class="selectedAgency ? 'grid-cols-1' : 'grid-cols-2'">
        <div v-if="!selectedAgency" class="space-y-1.5">
          <label class="text-sm font-medium">Role</label>
          <select
            v-model="selectedRoleId"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          >
            <option value="">Freeform (no role)</option>
            <option v-for="r in roles" :key="r.id" :value="r.id">
              {{ r.name }} ({{ r.scope }})
            </option>
          </select>
        </div>
        <div class="space-y-1.5">
          <label class="text-sm font-medium">
            {{ selectedAgency ? 'Fallback model' : 'Model' }}
          </label>
          <select
            v-model="model"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          >
            <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
              {{ m.label }}
            </option>
          </select>
        </div>
      </div>
      <p v-if="selectedRole?.description && !selectedAgency" class="text-xs text-muted-foreground pl-1">
        {{ selectedRole.description }}
      </p>

      <div class="space-y-1.5">
        <label class="text-sm font-medium">Effort</label>
        <select
          :value="effort"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          @change="onEffortChange"
        >
          <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">
            {{ e }}
          </option>
        </select>
      </div>

      <div
        v-if="startError"
        class="text-xs rounded-md bg-muted/40 px-3 py-2 text-destructive"
      >
        {{ startError }}
      </div>

      <footer class="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
        <Button
          size="sm"
          :disabled="!canStart || starting"
          :title="!selectedProject ? 'Select a project to start a session' : undefined"
          @click="void start()"
        >
          {{ starting ? 'Starting…' : selectedAgency ? 'Start agency' : 'Start session' }}
        </Button>
      </footer>
    </div>
  </dialog>

  <ProjectPicker
    :open="pickerOpen"
    :preselected="selectedProject?.path"
    @confirm="onPickerConfirm"
    @cancel="pickerOpen = false"
  />
</template>
