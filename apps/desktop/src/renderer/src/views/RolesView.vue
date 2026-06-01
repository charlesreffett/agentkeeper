<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { Button } from '@/components/ui/button'
import {
  ROLE_EFFORT_VALUES,
  type Role,
  type RoleDraft,
  type RoleScope,
} from '@shared/ipc-contract'
import { useClaudeAuth } from '@/composables/useClaudeAuth'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useRolesQuery } from '@/composables/useRolesQuery'
import PageHeader from '@/components/PageHeader.vue'
import SidebarHeader from '@/components/SidebarHeader.vue'
import { Bot, Plus } from 'lucide-vue-next'

const { focusedProject } = useProjectsQuery()
const projectPath = computed(() => focusedProject.value?.path ?? '')

const { roles, isLoading: loading, saveRole, removeRole } = useRolesQuery(projectPath)
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
  systemPrompt: '',
  scope: 'project',
})
const allowedToolsText = ref('')
const saving = ref(false)
const message = ref<string | null>(null)

const generatePrompt = ref('')
const generating = ref(false)
const generateError = ref<string | null>(null)

const { handleAuthError } = useClaudeAuth()

function resetGenerate() {
  generatePrompt.value = ''
  generating.value = false
  generateError.value = null
}

async function generate() {
  if (!generatePrompt.value.trim()) return
  generating.value = true
  generateError.value = null
  try {
    const result = await window.agentkeeper.roles.generate(generatePrompt.value.trim())
    form.value.id = uniqueRoleId(result.id)
    form.value.name = result.name
    form.value.description = result.description
    form.value.allowedTools = result.allowedTools
    allowedToolsText.value = result.allowedTools?.join(', ') ?? ''
    form.value.systemPrompt = result.systemPrompt
  } catch (e) {
    if (!handleAuthError(e)) {
      generateError.value = e instanceof Error ? e.message : String(e)
    }
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
    systemPrompt: '',
    scope: 'project',
  }
  allowedToolsText.value = ''
  resetGenerate()
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
    systemPrompt: role.systemPrompt,
    scope: role.scope,
  }
  allowedToolsText.value = (role.allowedTools ?? []).join(', ')
  resetGenerate()
}

function cancelEdit() {
  editing.value = false
  selectedId.value = null
  resetGenerate()
}

function uniqueRoleId(base: string): string {
  const existing = new Set(roles.value.map((r) => r.id))
  if (!existing.has(base)) return base
  let n = 2
  while (existing.has(`${base}-${n}`)) n++
  return `${base}-${n}`
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
      systemPrompt: form.value.systemPrompt.trim(),
    }
    await saveRole({ scope: form.value.scope, path: projectPath.value, draft })
    editing.value = false
    resetGenerate()
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
    await removeRole({ scope: role.scope, path: projectPath.value, id: role.id })
    if (selectedId.value === role.id) cancelEdit()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => focusedProject.value?.path,
  () => {
    editing.value = false
    selectedId.value = null
  },
)
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Roles" />

    <div class="flex min-h-0 flex-1">
      <aside
        class="w-64 border-r border-border shrink-0 flex flex-col bg-card/30"
      >
        <SidebarHeader title="Roles">
          <template #icon><Bot class="size-3" /></template>
          <template #actions>
            <button
              class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
              title="New role"
              @click="beginNew"
            >
              <Plus class="size-3.5" />
            </button>
          </template>
        </SidebarHeader>
        <div class="flex-1 overflow-y-auto">
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
        </div>
      </aside>

      <main class="flex-1 min-w-0" :class="editing ? 'overflow-hidden' : 'overflow-y-auto'">
        <div v-if="!editing" class="h-full flex items-center justify-center text-muted-foreground text-sm p-8">
          Select a role to edit, or create a new one.
        </div>
        <div v-else class="grid grid-cols-[2fr_3fr] h-full">
          <!-- Left column: metadata fields -->
          <div class="overflow-y-auto p-6 space-y-4">
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
              <textarea
                v-model="form.description"
                rows="3"
                placeholder="Full-stack developer focused on clean code"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-none"
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

          <!-- Right column: system prompt -->
          <div class="flex flex-col p-6 border-l border-border min-h-0">
            <label class="text-xs font-medium mb-1.5">System prompt</label>
            <textarea
              v-model="form.systemPrompt"
              placeholder="You are a senior developer focused on…"
              class="flex-1 h-full w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-ring font-sans resize-none"
            />
            <p class="text-[11px] text-muted-foreground mt-1.5">
              Appended to Claude Code's default system prompt — you don't
              need to repeat basic behavior.
            </p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
