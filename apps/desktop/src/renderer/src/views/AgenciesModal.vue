<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type {
  Agency,
  AgencyDraft,
  AgencyScope,
  Role,
} from '@shared/ipc-contract'

const props = defineProps<{ open: boolean; projectPath: string }>()
const emit = defineEmits<{
  close: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)

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

async function refresh() {
  loading.value = true
  message.value = null
  try {
    ;[agencies.value, roles.value] = await Promise.all([
      window.orchestral.agencies.list(props.projectPath),
      window.orchestral.roles.list(props.projectPath),
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
}

function beginEdit(a: Agency) {
  selectedId.value = a.id
  mode.value = 'edit'
  form.value = {
    id: a.id,
    name: a.name,
    description: a.description,
    roles: [...a.roles],
    flows: a.flows.map((f) => [...f] as [string, string]),
    entryPoints: [...a.entryPoints],
    notes: a.notes,
    scope: a.scope,
  }
}

function cancelMode() {
  mode.value = 'browse'
}

function toggleRole(roleId: string) {
  const idx = form.value.roles.indexOf(roleId)
  if (idx === -1) form.value.roles.push(roleId)
  else {
    form.value.roles.splice(idx, 1)
    form.value.entryPoints = form.value.entryPoints.filter((r) => r !== roleId)
    form.value.flows = form.value.flows.filter(
      ([a, b]) => a !== roleId && b !== roleId,
    )
  }
}

function toggleEntry(roleId: string) {
  if (!form.value.roles.includes(roleId)) return
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
      roles: [...form.value.roles],
      flows: form.value.flows.map((f) => [...f] as [string, string]),
      entryPoints: [...form.value.entryPoints],
      notes: form.value.notes.trim(),
    }
    await window.orchestral.agencies.save(
      form.value.scope,
      props.projectPath,
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
    await window.orchestral.agencies.remove(a.scope, props.projectPath, a.id)
    await refresh()
    if (selectedId.value === a.id) cancelMode()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

const availableRoleIds = computed(() => roles.value.map((r) => r.id))

function roleName(id: string) {
  return roles.value.find((r) => r.id === id)?.name ?? id
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      mode.value = 'browse'
      selectedId.value = null
      await refresh()
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-4xl w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col max-h-[88vh]">
      <header
        class="px-6 py-3 border-b border-border flex items-center justify-between shrink-0"
      >
        <h2 class="text-lg font-semibold">Agencies</h2>
        <div class="flex items-center gap-2">
          <Button size="sm" @click="beginNew">New agency</Button>
          <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
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
              <div v-if="availableRoleIds.length === 0" class="text-xs text-muted-foreground">
                No roles found. Create roles first.
              </div>
              <div v-else class="flex flex-wrap gap-2">
                <label
                  v-for="r in roles"
                  :key="r.id"
                  class="flex items-center gap-1.5 px-2 py-1 rounded border border-input cursor-pointer hover:bg-accent/50 text-xs"
                >
                  <input
                    type="checkbox"
                    :checked="form.roles.includes(r.id)"
                    class="size-3.5"
                    @change="toggleRole(r.id)"
                  />
                  <span class="font-mono">{{ r.id }}</span>
                  <span class="text-muted-foreground">· {{ r.name }}</span>
                </label>
              </div>
            </div>

            <div v-if="form.roles.length" class="space-y-2">
              <label class="text-xs font-medium">
                Entry points (receive user's initial prompt)
              </label>
              <div class="flex flex-wrap gap-2">
                <label
                  v-for="rid in form.roles"
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

            <div v-if="form.roles.length" class="space-y-2">
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
                  <option v-for="rid in form.roles" :key="rid" :value="rid">
                    {{ rid }}
                  </option>
                </select>
                <span class="text-muted-foreground">→</span>
                <select
                  v-model="flowTo"
                  class="flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs font-mono"
                >
                  <option value="">To…</option>
                  <option v-for="rid in form.roles" :key="rid" :value="rid">
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
  </dialog>
</template>
