<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import {
  ROLE_EFFORT_VALUES,
  type Role,
  type RoleDraft,
  type RoleScope,
} from '@shared/ipc-contract'

const props = defineProps<{ open: boolean; projectPath: string }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)

const roles = ref<Role[]>([])
const loading = ref(false)
const selectedId = ref<string | null>(null)
const editing = ref(false)

// Editor form state
const form = ref<RoleDraft & { scope: RoleScope }>({
  id: '',
  name: '',
  description: '',
  model: null,
  effort: 'medium',
  allowedTools: null,
  allowedPeers: null,
  systemPrompt: '',
  scope: 'project',
})
const allowedToolsText = ref('')
const allowedPeersText = ref('')
const saving = ref(false)
const message = ref<string | null>(null)

const generatePrompt = ref('')
const generating = ref(false)
const generateError = ref<string | null>(null)

async function generate() {
  if (!generatePrompt.value.trim()) return
  generating.value = true
  generateError.value = null
  try {
    const result = await window.agentkeeper.roles.generate(generatePrompt.value.trim())
    form.value.systemPrompt = result.systemPrompt
    if (!form.value.name.trim()) form.value.name = result.name
    if (!form.value.description.trim()) form.value.description = result.description
  } catch (e) {
    generateError.value = e instanceof Error ? e.message : String(e)
  } finally {
    generating.value = false
  }
}

const MODEL_OPTIONS = [
  { value: '', label: 'Session default' },
  { value: 'claude-opus-4-7', label: 'Opus 4.7' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
] as const

async function refresh() {
  loading.value = true
  message.value = null
  try {
    roles.value = await window.agentkeeper.roles.list(props.projectPath)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    roles.value = []
  } finally {
    loading.value = false
  }
}

function beginNew() {
  selectedId.value = null
  editing.value = true
  form.value = {
    id: '',
    name: '',
    description: '',
    model: null,
    effort: 'medium',
    allowedTools: null,
    allowedPeers: null,
    systemPrompt: '',
    scope: 'project',
  }
  allowedToolsText.value = ''
  allowedPeersText.value = ''
}

function beginEdit(role: Role) {
  selectedId.value = role.id
  editing.value = true
  form.value = {
    id: role.id,
    name: role.name,
    description: role.description,
    model: role.model,
    effort: role.effort,
    allowedTools: role.allowedTools,
    allowedPeers: role.allowedPeers,
    systemPrompt: role.systemPrompt,
    scope: role.scope,
  }
  allowedToolsText.value = (role.allowedTools ?? []).join(', ')
  allowedPeersText.value = (role.allowedPeers ?? []).join(', ')
}

function cancelEdit() {
  editing.value = false
  selectedId.value = null
}

function parseCsv(text: string): string[] | null {
  const items = text
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return items.length ? items : null
}

function validId(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(s)
}

async function save() {
  if (!form.value.name.trim()) {
    message.value = 'Name is required.'
    return
  }
  if (!form.value.id.trim()) {
    message.value = 'ID is required.'
    return
  }
  if (!validId(form.value.id)) {
    message.value =
      'ID must be lowercase letters, digits, and dashes — used as the filename.'
    return
  }

  saving.value = true
  message.value = null
  try {
    const draft: RoleDraft = {
      id: form.value.id.trim(),
      name: form.value.name.trim(),
      description: form.value.description.trim(),
      model: form.value.model || null,
      effort: form.value.effort || null,
      allowedTools: parseCsv(allowedToolsText.value),
      allowedPeers: parseCsv(allowedPeersText.value),
      systemPrompt: form.value.systemPrompt.trim(),
    }
    await window.agentkeeper.roles.save(form.value.scope, props.projectPath, draft)
    await refresh()
    editing.value = false
    emit('saved')
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(role: Role) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Remove role "${role.name}" (${role.scope})?`)) return
  try {
    await window.agentkeeper.roles.remove(role.scope, props.projectPath, role.id)
    await refresh()
    emit('saved')
    if (selectedId.value === role.id) cancelEdit()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      editing.value = false
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
    <div class="flex flex-col max-h-[85vh]">
      <header
        class="px-6 py-3 border-b border-border flex items-center justify-between shrink-0"
      >
        <h2 class="text-lg font-semibold">Roles</h2>
        <div class="flex items-center gap-2">
          <Button size="sm" @click="beginNew">New role</Button>
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
            v-else-if="roles.length === 0 && !editing"
            class="p-4 text-sm text-muted-foreground leading-relaxed"
          >
            No roles yet. Create one — they live in
            <code class="font-mono text-foreground">.agentkeeper/roles/</code>
            (project) or
            <code class="font-mono text-foreground">~/.agentkeeper/roles/</code>
            (global).
          </div>
          <ul v-else>
            <li
              v-for="r in roles"
              :key="`${r.scope}:${r.id}`"
              class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
              :class="selectedId === r.id ? 'bg-accent' : ''"
              @click="beginEdit(r)"
            >
              <div class="text-sm font-medium truncate">{{ r.name }}</div>
              <div class="text-xs text-muted-foreground truncate">
                {{ r.description || '(no description)' }}
              </div>
              <div class="mt-1 flex items-center gap-2 text-[10px] tabular-nums">
                <span
                  class="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono"
                >
                  {{ r.scope }}
                </span>
                <span class="text-muted-foreground font-mono">{{ r.id }}</span>
              </div>
            </li>
          </ul>
        </aside>

        <main class="flex-1 overflow-y-auto min-w-0">
          <div v-if="!editing" class="h-full flex items-center justify-center text-muted-foreground text-sm p-8">
            Select a role to edit, or create a new one.
          </div>
          <div v-else class="p-6 space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="text-xs font-medium">ID (filename)</label>
                <input
                  v-model="form.id"
                  type="text"
                  placeholder="developer"
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
                placeholder="Developer"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
              />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium">Description</label>
              <input
                v-model="form.description"
                type="text"
                placeholder="Full-stack developer focused on clean code"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <label class="text-xs font-medium">Default model</label>
                <select
                  v-model="form.model"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
                >
                  <option v-for="m in MODEL_OPTIONS" :key="m.value" :value="m.value || null">
                    {{ m.label }}
                  </option>
                </select>
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium">Effort</label>
                <select
                  v-model="form.effort"
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
                >
                  <option :value="null">SDK default</option>
                  <option v-for="e in ROLE_EFFORT_VALUES" :key="e" :value="e">
                    {{ e }}
                  </option>
                </select>
              </div>
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium">Allowed tools (comma-separated)</label>
              <input
                v-model="allowedToolsText"
                type="text"
                placeholder="Read, Edit, Write, Bash, Grep"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              />
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium">Allowed peers (comma-separated)</label>
              <input
                v-model="allowedPeersText"
                type="text"
                placeholder="pm, qa"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
              />
              <p class="text-[11px] text-muted-foreground">
                Used later when this role is part of an Agency (V3.4) — which
                peer roles can this one send_message() to.
              </p>
            </div>

            <div class="rounded-md border border-border/60 bg-muted/20 p-3 space-y-2">
              <label class="text-xs font-medium text-muted-foreground">Generate with AI</label>
              <textarea
                v-model="generatePrompt"
                rows="2"
                placeholder='Describe the role, e.g. "A TypeScript developer who writes tests and reviews PRs"'
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-sans resize-none"
              />
              <div class="flex items-center gap-3">
                <Button size="sm" variant="secondary" :disabled="generating || !generatePrompt.trim()" @click="generate">
                  {{ generating ? 'Generating…' : 'Generate' }}
                </Button>
                <span v-if="generateError" class="text-xs text-destructive">{{ generateError }}</span>
              </div>
            </div>

            <div class="space-y-1.5">
              <label class="text-xs font-medium">System prompt</label>
              <textarea
                v-model="form.systemPrompt"
                rows="10"
                placeholder="You are a senior developer focused on…"
                class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-ring font-sans resize-none"
              />
              <p class="text-[11px] text-muted-foreground">
                Appended to Claude Code's default system prompt — you don't
                need to repeat basic behavior.
              </p>
            </div>

            <div
              v-if="message"
              class="text-xs rounded-md bg-muted/40 px-3 py-2"
              :class="saving ? 'text-muted-foreground' : 'text-destructive'"
            >
              {{ message }}
            </div>

            <div class="flex items-center justify-between pt-2">
              <Button
                v-if="selectedId"
                variant="ghost"
                size="sm"
                class="text-destructive"
                @click="
                  () => {
                    const r = roles.find((x) => x.id === selectedId)
                    if (r) remove(r)
                  }
                "
              >
                Delete
              </Button>
              <div v-else />
              <div class="flex gap-2">
                <Button variant="ghost" size="sm" @click="cancelEdit">Cancel</Button>
                <Button size="sm" :disabled="saving" @click="save">
                  {{ saving ? 'Saving…' : 'Save' }}
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  </dialog>
</template>
