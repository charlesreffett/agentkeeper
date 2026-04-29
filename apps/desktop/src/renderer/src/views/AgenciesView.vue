<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type {
  Agency,
  AgencyDraft,
  AgencyScope,
  Role,
  RoleSlot,
} from '@shared/ipc-contract'
import { useProjectsStore } from '@/stores/projects'

const projectsStore = useProjectsStore()
const projectPath = computed(() => projectsStore.focusedProject?.path ?? '')

const agencies = ref<Agency[]>([])
const roles = ref<Role[]>([])
const loading = ref(false)
const message = ref<string | null>(null)

type Mode = 'browse' | 'edit'
const mode = ref<Mode>('browse')
const selectedId = ref<string | null>(null)

// ─── Editor state ──────────────────────────────────────────────────────────
const form = ref<AgencyDraft & { scope: AgencyScope }>({
  id: '',
  name: '',
  description: '',
  roles: [],
  flows: [],
  entryPoints: [],
  notes: '',
  scope: 'project',
})
const flowFrom = ref('')
const flowTo = ref('')
const saving = ref(false)

// Multiplicity mode per role in the editor: 'x1' | 'fixed' | 'dynamic'
const multiplicityMode = ref<Record<string, 'x1' | 'fixed' | 'dynamic'>>({})
// Extra config for fixed/dynamic modes
const multiplicityCount = ref<Record<string, number>>({})
const multiplicityMin = ref<Record<string, number>>({})
const multiplicityMax = ref<Record<string, number>>({})

async function refresh() {
  loading.value = true
  message.value = null
  try {
    ;[agencies.value, roles.value] = await Promise.all([
      window.agentkeeper.agencies.list(projectPath.value),
      window.agentkeeper.roles.list(projectPath.value),
    ])
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function beginNew() {
  selectedId.value = null
  mode.value = 'edit'
  form.value = {
    id: '',
    name: '',
    description: '',
    roles: [],
    flows: [],
    entryPoints: [],
    notes: '',
    scope: 'project',
  }
  multiplicityMode.value = {}
  multiplicityCount.value = {}
  multiplicityMin.value = {}
  multiplicityMax.value = {}
}

function beginEdit(a: Agency) {
  selectedId.value = a.id
  mode.value = 'edit'
  form.value = {
    id: a.id,
    name: a.name,
    description: a.description,
    roles: a.roles.map((s) => ({ ...s })),
    flows: a.flows.map((f) => [...f] as [string, string]),
    entryPoints: [...a.entryPoints],
    notes: a.notes,
    scope: a.scope,
  }
  // Restore multiplicity controls from existing RoleSlots
  const mMode: Record<string, 'x1' | 'fixed' | 'dynamic'> = {}
  const mCount: Record<string, number> = {}
  const mMin: Record<string, number> = {}
  const mMax: Record<string, number> = {}
  for (const slot of a.roles) {
    if (slot.min !== undefined || slot.max !== undefined) {
      mMode[slot.roleId] = 'dynamic'
      mMin[slot.roleId] = slot.min ?? 1
      mMax[slot.roleId] = slot.max ?? 3
    } else if (slot.count !== undefined && slot.count > 1) {
      mMode[slot.roleId] = 'fixed'
      mCount[slot.roleId] = slot.count
    } else {
      mMode[slot.roleId] = 'x1'
    }
  }
  multiplicityMode.value = mMode
  multiplicityCount.value = mCount
  multiplicityMin.value = mMin
  multiplicityMax.value = mMax
}

function cancelMode() {
  mode.value = 'browse'
}

function roleSelected(roleId: string): boolean {
  return form.value.roles.some((s) => s.roleId === roleId)
}

function toggleRole(roleId: string) {
  const idx = form.value.roles.findIndex((s) => s.roleId === roleId)
  if (idx === -1) {
    form.value.roles.push({ roleId })
    multiplicityMode.value[roleId] = 'x1'
    multiplicityCount.value[roleId] = 2
    multiplicityMin.value[roleId] = 1
    multiplicityMax.value[roleId] = 3
  } else {
    form.value.roles.splice(idx, 1)
    form.value.entryPoints = form.value.entryPoints.filter((r) => r !== roleId)
    form.value.flows = form.value.flows.filter(([a, b]) => a !== roleId && b !== roleId)
    delete multiplicityMode.value[roleId]
    delete multiplicityCount.value[roleId]
    delete multiplicityMin.value[roleId]
    delete multiplicityMax.value[roleId]
  }
}

function toggleEntry(roleId: string) {
  if (!roleSelected(roleId)) return
  const idx = form.value.entryPoints.indexOf(roleId)
  if (idx === -1) form.value.entryPoints.push(roleId)
  else form.value.entryPoints.splice(idx, 1)
}

function addFlow() {
  if (!flowFrom.value || !flowTo.value) return
  if (flowFrom.value === flowTo.value) return
  const exists = form.value.flows.some(
    ([a, b]) => a === flowFrom.value && b === flowTo.value,
  )
  if (!exists) form.value.flows.push([flowFrom.value, flowTo.value])
  flowFrom.value = ''
  flowTo.value = ''
}

function removeFlow(i: number) {
  form.value.flows.splice(i, 1)
}

function validId(s: string) {
  return /^[a-z0-9][a-z0-9-]*$/.test(s)
}

/** Build the final RoleSlot[] from form + multiplicity controls */
function buildRoleSlots(): RoleSlot[] {
  return form.value.roles.map((slot) => {
    const m = multiplicityMode.value[slot.roleId] ?? 'x1'
    if (m === 'fixed') {
      const count = Math.max(1, multiplicityCount.value[slot.roleId] ?? 2)
      return { roleId: slot.roleId, count }
    }
    if (m === 'dynamic') {
      const min = Math.max(1, multiplicityMin.value[slot.roleId] ?? 1)
      const max = Math.max(min + 1, multiplicityMax.value[slot.roleId] ?? 3)
      return { roleId: slot.roleId, min, max }
    }
    return { roleId: slot.roleId }
  })
}

async function save() {
  if (!form.value.id.trim() || !validId(form.value.id)) {
    message.value = 'ID must be lowercase letters, digits, dashes.'
    return
  }
  if (!form.value.name.trim()) {
    message.value = 'Name required.'
    return
  }
  if (form.value.roles.length === 0) {
    message.value = 'Pick at least one role.'
    return
  }
  if (form.value.entryPoints.length === 0) {
    message.value = 'Mark at least one role as an entry point.'
    return
  }
  saving.value = true
  message.value = null
  try {
    const draft: AgencyDraft = {
      id: form.value.id.trim(),
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      roles: buildRoleSlots(),
      flows: form.value.flows.map((f) => [...f] as [string, string]),
      entryPoints: [...form.value.entryPoints],
      notes: form.value.notes.trim(),
    }
    await window.agentkeeper.agencies.save(
      form.value.scope,
      projectPath.value,
      draft,
    )
    await refresh()
    mode.value = 'browse'
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(a: Agency) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Remove agency "${a.name}" (${a.scope})?`)) return
  try {
    await window.agentkeeper.agencies.remove(a.scope, projectPath.value, a.id)
    await refresh()
    if (selectedId.value === a.id) cancelMode()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

const availableRoles = computed(() => roles.value)

const selectedRoleIds = computed(() => form.value.roles.map((s) => s.roleId))

function roleName(id: string) {
  return roles.value.find((r) => r.id === id)?.name ?? id
}

function roleSlotLabel(slot: RoleSlot): string {
  if (slot.min !== undefined || slot.max !== undefined) {
    return `${slot.min ?? 1}–${slot.max ?? '?'}`
  }
  if (slot.count !== undefined && slot.count > 1) return `×${slot.count}`
  return ''
}

watch(
  () => projectsStore.focusedProject,
  async () => {
    mode.value = 'browse'
    selectedId.value = null
    await refresh()
  },
)

onMounted(async () => {
  mode.value = 'browse'
  selectedId.value = null
  await refresh()
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <header
      class="px-6 py-3 border-b border-border flex items-center justify-between shrink-0"
    >
      <h2 class="text-lg font-semibold">Agencies</h2>
      <div class="flex items-center gap-2">
        <Button size="sm" @click="beginNew">New agency</Button>
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside
        class="w-64 border-r border-border shrink-0 overflow-y-auto bg-card/30"
      >
        <div v-if="loading" class="p-4 text-sm text-muted-foreground">
          Loading…
        </div>
        <div
          v-else-if="agencies.length === 0"
          class="p-4 text-sm text-muted-foreground leading-relaxed"
        >
          No agencies yet. Roles must exist before you can build an agency
          from them.
        </div>
        <ul v-else>
          <li
            v-for="a in agencies"
            :key="`${a.scope}:${a.id}`"
            class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
            :class="selectedId === a.id ? 'bg-accent' : ''"
            @click="selectedId = a.id"
          >
            <div class="text-sm font-medium truncate">{{ a.name }}</div>
            <div class="text-xs text-muted-foreground truncate">
              {{ a.description || '(no description)' }}
            </div>
            <div class="mt-1 flex items-center gap-2 text-[10px] tabular-nums">
              <span
                class="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono"
              >
                {{ a.scope }}
              </span>
              <span class="text-muted-foreground">
                {{ a.roles.length }} role{{ a.roles.length === 1 ? '' : 's' }}
              </span>
            </div>
            <div class="mt-1 flex gap-1 justify-end text-[11px]">
              <button
                class="text-muted-foreground hover:text-foreground hover:underline"
                @click.stop="beginEdit(a)"
              >
                Edit
              </button>
              <span class="text-muted-foreground">·</span>
              <button
                class="text-destructive hover:underline"
                @click.stop="remove(a)"
              >
                Delete
              </button>
            </div>
          </li>
        </ul>
      </aside>

      <main class="flex-1 overflow-y-auto min-w-0">
        <!-- Browse / empty state -->
        <div
          v-if="mode === 'browse'"
          class="h-full flex items-center justify-center text-muted-foreground text-sm p-8 text-center"
        >
          <div>
            <p>Select an agency to edit it, or create a new one.</p>
            <p class="mt-2 text-xs">
              An agency is a named bundle of roles that collaborate via
              <code class="font-mono text-foreground">send_message</code>.
            </p>
          </div>
        </div>

        <!-- Editor -->
        <div v-else-if="mode === 'edit'" class="p-6 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-xs font-medium">ID (filename)</label>
              <input
                v-model="form.id"
                type="text"
                placeholder="delivery-team"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-medium">Scope</label>
              <select
                v-model="form.scope"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
              >
                <option value="project">Project</option>
                <option value="global">Global</option>
              </select>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium">Name</label>
            <input
              v-model="form.name"
              type="text"
              placeholder="Delivery Team"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
            />
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium">Description</label>
            <input
              v-model="form.description"
              type="text"
              placeholder="PM plans, Dev implements, QA reviews"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
            />
          </div>

          <div class="space-y-2">
            <label class="text-xs font-medium">Roles in this agency</label>
            <div v-if="availableRoles.length === 0" class="text-xs text-muted-foreground">
              No roles found. Create roles first.
            </div>
            <div v-else class="space-y-1.5">
              <div
                v-for="r in availableRoles"
                :key="r.id"
                class="flex items-center gap-2 flex-wrap"
              >
                <!-- Checkbox + role label -->
                <label
                  class="flex items-center gap-1.5 px-2 py-1 rounded border border-input cursor-pointer hover:bg-accent/50 text-xs min-w-0"
                >
                  <input
                    type="checkbox"
                    :checked="roleSelected(r.id)"
                    class="size-3.5 shrink-0"
                    @change="toggleRole(r.id)"
                  />
                  <span class="font-mono">{{ r.id }}</span>
                  <span class="text-muted-foreground">· {{ r.name }}</span>
                </label>

                <!-- Multiplicity controls — only when role is checked -->
                <template v-if="roleSelected(r.id)">
                  <!-- Mode segmented control -->
                  <div class="flex rounded border border-input overflow-hidden text-[11px] shrink-0">
                    <button
                      v-for="opt in [['x1', '×1'], ['fixed', 'Fixed'], ['dynamic', 'Dynamic']] as [string, string][]"
                      :key="opt[0]"
                      class="px-2 py-0.5 transition"
                      :class="
                        multiplicityMode[r.id] === opt[0]
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-muted-foreground hover:bg-accent/50'
                      "
                      type="button"
                      @click="multiplicityMode[r.id] = opt[0] as 'x1' | 'fixed' | 'dynamic'"
                    >
                      {{ opt[1] }}
                    </button>
                  </div>

                  <!-- Fixed count spinner -->
                  <template v-if="multiplicityMode[r.id] === 'fixed'">
                    <label class="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                      Count
                      <input
                        v-model.number="multiplicityCount[r.id]"
                        type="number"
                        min="1"
                        class="w-14 rounded border border-input bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:border-ring"
                      />
                    </label>
                  </template>

                  <!-- Dynamic min/max spinners -->
                  <template v-if="multiplicityMode[r.id] === 'dynamic'">
                    <label class="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                      Min
                      <input
                        v-model.number="multiplicityMin[r.id]"
                        type="number"
                        min="1"
                        class="w-14 rounded border border-input bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:border-ring"
                      />
                    </label>
                    <label class="flex items-center gap-1 text-[11px] text-muted-foreground shrink-0">
                      Max
                      <input
                        v-model.number="multiplicityMax[r.id]"
                        type="number"
                        min="2"
                        class="w-14 rounded border border-input bg-background px-1.5 py-0.5 text-xs focus:outline-none focus:border-ring"
                      />
                    </label>
                  </template>
                </template>
              </div>
            </div>
          </div>

          <div v-if="selectedRoleIds.length" class="space-y-2">
            <label class="text-xs font-medium">
              Entry points (receive user's initial prompt)
            </label>
            <div class="flex flex-wrap gap-2">
              <label
                v-for="rid in selectedRoleIds"
                :key="rid"
                class="flex items-center gap-1.5 px-2 py-1 rounded border border-input cursor-pointer hover:bg-accent/50 text-xs"
              >
                <input
                  type="checkbox"
                  :checked="form.entryPoints.includes(rid)"
                  class="size-3.5"
                  @change="toggleEntry(rid)"
                />
                <span class="font-mono">{{ rid }}</span>
              </label>
            </div>
          </div>

          <div v-if="selectedRoleIds.length" class="space-y-2">
            <label class="text-xs font-medium">
              Flows (sender → receiver allowlist)
            </label>
            <p class="text-[11px] text-muted-foreground">
              Leave empty to allow any-to-any messaging. Otherwise, only
              flows listed here permit send_message.
            </p>
            <div class="flex items-center gap-2">
              <select
                v-model="flowFrom"
                class="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
              >
                <option value="">From…</option>
                <option v-for="rid in selectedRoleIds" :key="rid" :value="rid">
                  {{ rid }}
                </option>
              </select>
              <span class="text-muted-foreground">→</span>
              <select
                v-model="flowTo"
                class="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
              >
                <option value="">To…</option>
                <option v-for="rid in selectedRoleIds" :key="rid" :value="rid">
                  {{ rid }}
                </option>
              </select>
              <Button size="sm" variant="outline" @click="addFlow">Add</Button>
            </div>
            <ul v-if="form.flows.length" class="space-y-1">
              <li
                v-for="(f, i) in form.flows"
                :key="`${f[0]}-${f[1]}-${i}`"
                class="flex items-center gap-2 text-xs font-mono"
              >
                <span>{{ f[0] }} → {{ f[1] }}</span>
                <button
                  class="text-destructive hover:underline"
                  @click="removeFlow(i)"
                >
                  remove
                </button>
              </li>
            </ul>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium">Notes</label>
            <textarea
              v-model="form.notes"
              rows="3"
              placeholder="How this agency is meant to operate…"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:border-ring font-sans resize-none"
            />
          </div>

          <div
            v-if="message"
            class="text-xs rounded-md bg-muted/40 px-3 py-2 text-destructive"
          >
            {{ message }}
          </div>

          <div class="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" @click="cancelMode">Cancel</Button>
            <Button size="sm" :disabled="saving" @click="save">
              {{ saving ? 'Saving…' : 'Save' }}
            </Button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
