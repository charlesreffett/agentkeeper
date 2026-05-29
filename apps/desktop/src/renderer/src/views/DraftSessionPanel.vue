<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  ROLE_EFFORT_VALUES,
  type Agency,
  type PermissionMode,
  type Role,
  type RoleEffort,
} from '@shared/ipc-contract'
import type { LiveSession } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'

const props = defineProps<{
  session: LiveSession
}>()

const { focusedProject } = useProjectsQuery()

const roles = ref<Role[]>([])
const agencies = ref<Agency[]>([])

const cfg = computed(() => props.session.draftConfig!)

const selectedAgency = computed<Agency | null>(() =>
  cfg.value.agencyKey
    ? (agencies.value.find((a) => `${a.scope}:${a.id}` === cfg.value.agencyKey) ?? null)
    : null,
)

const selectedRole = computed<Role | null>(() =>
  cfg.value.roleId
    ? (roles.value.find((r) => r.id === cfg.value.roleId) ?? null)
    : null,
)

const MODEL_OPTIONS = [
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'bypassPermissions', label: 'Bypass (auto-approve all)' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'default', label: 'Default (prompt)' },
  { value: 'plan', label: 'Plan only (read-only)' },
]

async function loadRoles() {
  try {
    roles.value = await window.agentkeeper.roles.list(props.session.projectPath)
  } catch {
    roles.value = []
  }
}

async function loadAgencies() {
  try {
    agencies.value = await window.agentkeeper.agencies.list(props.session.projectPath)
  } catch {
    agencies.value = []
  }
}

watch(selectedRole, (r) => {
  if (r?.model) props.session.model = r.model
  if (!cfg.value.effortTouched) {
    props.session.effort = r?.effort ?? props.session.effort
  }
})

function onEffortChange(event: Event) {
  cfg.value.effortTouched = true
  props.session.effort = (event.target as HTMLSelectElement).value as RoleEffort
}

function onBranchInput(event: Event) {
  cfg.value.branchTouched = true
  cfg.value.branch = (event.target as HTMLInputElement).value
}

function onModelChange(event: Event) {
  props.session.model = (event.target as HTMLSelectElement).value
}

function onPermChange(event: Event) {
  props.session.permissionMode = (event.target as HTMLSelectElement).value as PermissionMode
}

watch(
  () => props.session.projectPath,
  () => {
    void loadRoles()
    void loadAgencies()
  },
)

watch(
  () => focusedProject.value?.path,
  (newPath) => {
    if (newPath && newPath !== props.session.projectPath) {
      props.session.projectPath = newPath
      cfg.value.agencyKey = ''
      cfg.value.roleId = ''
    }
  },
)

onMounted(() => {
  void loadRoles()
  void loadAgencies()
})
</script>

<template>
  <div class="max-w-2xl mx-auto p-6 space-y-4">
    <header class="space-y-1">
      <h2 class="text-lg font-semibold">New session</h2>
      <p class="text-xs text-muted-foreground">
        Configure the session, then send your first message to start it.
      </p>
    </header>

    <!-- Agency selector -->
    <div class="space-y-1.5">
      <label class="text-sm font-medium">
        Agency
        <span class="text-muted-foreground font-normal text-xs">(optional)</span>
      </label>
      <select
        v-model="cfg.agencyKey"
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

    <!-- Worktree -->
    <div class="space-y-3 rounded-md border border-border bg-muted/20 p-3">
      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          v-model="cfg.useWorktree"
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
      <div v-if="cfg.useWorktree" class="space-y-1.5 pl-6">
        <label class="text-xs text-muted-foreground">Branch name</label>
        <input
          :value="cfg.branch"
          type="text"
          placeholder="e.g. add-login-page"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
          @input="onBranchInput"
        />
      </div>
    </div>

    <!-- Role + Model row -->
    <div class="grid grid-cols-2 gap-3">
      <div v-if="!selectedAgency" class="space-y-1.5">
        <label class="text-sm font-medium">Role</label>
        <select
          v-model="cfg.roleId"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        >
          <option value="">Freeform (no role)</option>
          <option v-for="r in roles" :key="r.id" :value="r.id">
            {{ r.name }} ({{ r.scope }})
          </option>
        </select>
      </div>
      <div class="space-y-1.5" :class="selectedAgency ? 'col-span-2' : ''">
        <label class="text-sm font-medium">
          {{ selectedAgency ? 'Fallback model' : 'Model' }}
        </label>
        <select
          :value="props.session.model ?? MODEL_OPTIONS[0].value"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          @change="onModelChange"
        >
          <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value">
            {{ m.label }}
          </option>
        </select>
      </div>
    </div>
    <p
      v-if="selectedRole?.description && !selectedAgency"
      class="text-xs text-muted-foreground pl-1"
    >
      {{ selectedRole.description }}
    </p>

    <div class="space-y-1.5">
      <label class="text-sm font-medium">Effort</label>
      <select
        :value="props.session.effort ?? 'medium'"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        @change="onEffortChange"
      >
        <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">
          {{ e }}
        </option>
      </select>
    </div>

    <div class="space-y-1.5">
      <label class="text-sm font-medium">Permissions</label>
      <select
        :value="props.session.permissionMode ?? 'bypassPermissions'"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        @change="onPermChange"
      >
        <option v-for="p in PERMISSION_MODE_OPTIONS" :key="p.value" :value="p.value">
          {{ p.label }}
        </option>
      </select>
    </div>
  </div>
</template>
