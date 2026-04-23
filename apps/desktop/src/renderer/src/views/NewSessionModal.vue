<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  ROLE_EFFORT_VALUES,
  type Role,
  type RoleEffort,
} from '@shared/ipc-contract'

const props = defineProps<{
  open: boolean
  projectPath: string
  defaultModel: string
  defaultEffort: RoleEffort
}>()

const emit = defineEmits<{
  close: []
  start: [
    params: {
      initialPrompt: string
      model: string
      effort: RoleEffort
      useWorktree: boolean
      branch: string
      role: Role | null
    },
  ]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const prompt = ref('')
const model = ref(props.defaultModel)
const textarea = ref<HTMLTextAreaElement | null>(null)

const useWorktree = ref(true)
const branch = ref('')
const branchTouched = ref(false)

const effort = ref<RoleEffort>(props.defaultEffort)
const effortTouched = ref(false)

const roles = ref<Role[]>([])
const selectedRoleId = ref<string>('') // '' = freeform

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

async function loadRoles() {
  try {
    roles.value = await window.orchestral.roles.list(props.projectPath)
  } catch {
    roles.value = []
  }
}

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

// When a role is picked, apply its model and effort (unless the user has
// already overridden effort manually for this session). Precedence:
//   manual (this dialog) > role > settings default
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
  if (!prompt.value.trim()) return false
  if (useWorktree.value && !branch.value.trim()) return false
  return true
})

function start() {
  if (!canStart.value) return
  emit('start', {
    initialPrompt: prompt.value.trim(),
    model: model.value,
    effort: effort.value,
    useWorktree: useWorktree.value,
    branch: branch.value.trim(),
    role: selectedRole.value,
  })
}

function onKeyDown(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    start()
  }
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
      useWorktree.value = true
      selectedRoleId.value = ''
      await loadRoles()
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
      await loadRoles()
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
        <p class="text-xs text-muted-foreground font-mono truncate">
          {{ projectPath }}
        </p>
      </header>

      <div class="space-y-2">
        <label class="text-sm font-medium">Initial prompt</label>
        <textarea
          ref="textarea"
          v-model="prompt"
          rows="8"
          placeholder="What do you want to work on?"
          class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-ring font-sans resize-none"
          @keydown="onKeyDown"
        />
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

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1.5">
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
          <label class="text-sm font-medium">Model</label>
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
      <p v-if="selectedRole?.description" class="text-xs text-muted-foreground pl-1">
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

      <footer class="flex items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
        <Button size="sm" :disabled="!canStart" @click="start">
          Start session
        </Button>
      </footer>
    </div>
  </dialog>
</template>
