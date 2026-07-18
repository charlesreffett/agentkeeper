<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  type Agency,
  type McpServerEntry,
  type PermissionMode,
  type Role,
  type RoleEffort,
} from '@shared/ipc-contract'
import type { LiveSession } from '@/stores/sessions'
import { ChevronDown } from 'lucide-vue-next'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useModelsQuery } from '@/composables/useModelsQuery'
import ModelPicker from '@/components/ModelPicker.vue'

const props = defineProps<{
  session: LiveSession
}>()

const { focusedProject } = useProjectsQuery()

const roles = ref<Role[]>([])
const agencies = ref<Agency[]>([])
const mcpServers = ref<McpServerEntry[]>([])

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

const { models: availableModels, effortLevelsFor, defaultValue: defaultModel, error: modelsError, isEmpty: noModels } = useModelsQuery()

// Once the user explicitly picks or types a model, respect it — including a
// deliberate off-list value in freeform mode. The redirect below is only for a
// stale seeded default the user never touched.
const modelTouched = ref(false)

// A new draft seeds its model from the app default, which may be a stale value
// the harness no longer offers. Redirect to the harness default rather than
// starting a session on an unavailable model. (Live sessions keep their stored
// value via optionsFor's pass-through row — this only runs in the draft panel.)
watch([availableModels, () => props.session.model], () => {
  if (!availableModels.value.length) return
  if (modelTouched.value) return
  const m = props.session.model
  if (m && !availableModels.value.some((x) => x.value === m)) {
    props.session.model = defaultModel.value
  }
}, { immediate: true })

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

async function loadMcpServers() {
  try {
    const settings = await window.agentkeeper.settings.get()
    mcpServers.value = settings.mcpServers ?? []
    // Pre-check servers that are enabled by default, but only on first load
    // (don't stomp existing selections if the user already toggled something).
    if (cfg.value.mcpServerIds.length === 0) {
      cfg.value.mcpServerIds = mcpServers.value
        .filter((s) => s.enabledByDefault)
        .map((s) => s.id)
    }
  } catch {
    mcpServers.value = []
  }
}

function toggleMcpServer(id: string) {
  const ids = cfg.value.mcpServerIds
  const idx = ids.indexOf(id)
  if (idx === -1) {
    cfg.value.mcpServerIds = [...ids, id]
  } else {
    cfg.value.mcpServerIds = ids.filter((i) => i !== id)
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

function onModelPicked(value: string) {
  props.session.model = value
  modelTouched.value = true
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
  void loadMcpServers()
})
</script>

<template>
  <div class="w-full max-w-2xl mx-auto p-6 space-y-4">
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
    <div v-if="!selectedAgency" class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
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
      <div class="space-y-1.5">
        <label class="text-sm font-medium">Model</label>
        <ModelPicker
          :model-value="props.session.model ?? ''"
          :disabled="noModels"
          @update:model-value="onModelPicked"
        >
          <template #trigger="{ label }">
            <button
              type="button"
              :disabled="noModels"
              class="flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent transition-colors focus:outline-none focus:border-ring disabled:opacity-50"
            >
              <span class="truncate">{{ label }}</span>
              <ChevronDown class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </template>
        </ModelPicker>
        <p v-if="modelsError" class="text-xs text-destructive">Harness unavailable — no models. {{ modelsError }}</p>
      </div>
    </div>
    <p
      v-if="selectedRole?.description && !selectedAgency"
      class="text-xs text-muted-foreground pl-1"
    >
      {{ selectedRole.description }}
    </p>

    <div v-if="!selectedAgency" class="space-y-1.5">
      <label class="text-sm font-medium">Effort</label>
      <select
        :value="props.session.effort ?? 'medium'"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
        @change="onEffortChange"
      >
        <option v-for="e in effortLevelsFor(props.session.model)" :key="e" :value="e">
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

    <!-- MCP servers -->
    <div v-if="mcpServers.length > 0" class="space-y-2">
      <div class="flex items-center justify-between">
        <label class="text-sm font-medium">MCP Servers</label>
        <span class="text-xs text-muted-foreground">Active for this session</span>
      </div>
      <div class="rounded-md border border-border bg-muted/20 divide-y divide-border">
        <label
          v-for="server in mcpServers"
          :key="server.id"
          class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors first:rounded-t-md last:rounded-b-md"
        >
          <input
            type="checkbox"
            :checked="cfg.mcpServerIds.includes(server.id)"
            class="size-4 rounded border-input shrink-0"
            @change="toggleMcpServer(server.id)"
          />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">{{ server.name }}</p>
            <p class="text-xs text-muted-foreground font-mono truncate">
              <template v-if="server.type === 'stdio'">{{ server.command }}</template>
              <template v-else>{{ server.url }}</template>
            </p>
          </div>
          <span class="text-xs text-muted-foreground uppercase tracking-wide shrink-0">
            {{ server.type }}
          </span>
        </label>
      </div>
    </div>
  </div>
</template>
