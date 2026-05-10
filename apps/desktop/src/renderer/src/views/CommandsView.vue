<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { SlashCommand } from '@shared/ipc-contract'
import { useClaudeAuth } from '@/composables/useClaudeAuth'
import { useProjectsStore } from '@/stores/projects'
import { useCommandsDataStore } from '@/stores/commandsData'
import PageHeader from '@/components/PageHeader.vue'
import SidebarHeader from '@/components/SidebarHeader.vue'
import { Terminal } from 'lucide-vue-next'

const projectsStore = useProjectsStore()
const commandsDataStore = useCommandsDataStore()
const projectPath = computed(() => projectsStore.focusedProject?.path ?? '')
const { handleAuthError } = useClaudeAuth()

const commands = computed(() => commandsDataStore.commands)
const loading = computed(() => commandsDataStore.loading)
const selectedId = ref<string | null>(null)
const editing = ref(false)
const message = ref<string | null>(null)
const saving = ref(false)

const form = ref<{ id: string; scope: 'project' | 'global'; body: string }>({
  id: '',
  scope: 'project',
  body: '',
})
const isNew = ref(false)

const generatePrompt = ref('')
const generating = ref(false)

function toSlug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
}

async function generateCommand() {
  const p = generatePrompt.value.trim()
  if (!p) {
    message.value = 'Describe the command first.'
    return
  }
  generating.value = true
  message.value = null
  try {
    const body = await window.agentkeeper.commands.generate(p)
    form.value.body = body
    // Auto-suggest ID from H1 only if user hasn't typed one yet
    if (!form.value.id) {
      const h1Match = body.match(/^#\s+(.+)$/m)
      if (h1Match) form.value.id = toSlug(h1Match[1]!)
    }
  } catch (e) {
    if (!handleAuthError(e)) {
      message.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    generating.value = false
  }
}

async function refresh() {
  message.value = null
  try {
    commandsDataStore.invalidate()
    await commandsDataStore.load(projectPath.value)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

function beginNew() {
  selectedId.value = null
  isNew.value = true
  editing.value = true
  form.value = { id: '', scope: 'project', body: '' }
  generatePrompt.value = ''
  message.value = null
}

function beginEdit(cmd: SlashCommand) {
  selectedId.value = `${cmd.scope}:${cmd.id}`
  isNew.value = false
  editing.value = true
  form.value = { id: cmd.id, scope: cmd.scope, body: cmd.body }
}

function cancelEdit() {
  editing.value = false
  selectedId.value = null
}

function validId(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(s)
}

async function save() {
  const id = form.value.id.trim()
  if (!id) {
    message.value = 'ID is required.'
    return
  }
  if (!validId(id)) {
    message.value = 'ID must be lowercase letters, digits, and dashes.'
    return
  }
  saving.value = true
  message.value = null
  try {
    await window.agentkeeper.commands.save(
      form.value.scope,
      projectPath.value,
      id,
      form.value.body,
    )
    await refresh()
    editing.value = false
    selectedId.value = null
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function remove(cmd: SlashCommand) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Remove command "/${cmd.id}" (${cmd.scope})?`)) return
  try {
    await window.agentkeeper.commands.remove({ ...cmd })
    await refresh()
    if (selectedId.value === `${cmd.scope}:${cmd.id}`) cancelEdit()
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

watch(
  () => projectsStore.focusedProject?.path,
  async (path) => {
    editing.value = false
    selectedId.value = null
    if (path !== undefined) await commandsDataStore.load(path ?? '')
  },
)

onMounted(async () => {
  editing.value = false
  selectedId.value = null
  await commandsDataStore.load(projectPath.value)
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Commands">
      <template #actions>
        <Button size="sm" @click="beginNew">New command</Button>
      </template>
    </PageHeader>

    <div class="flex min-h-0 flex-1">
      <aside
        class="w-64 border-r border-border shrink-0 flex flex-col bg-card/30"
      >
        <SidebarHeader title="Commands">
          <template #icon><Terminal class="size-3" /></template>
        </SidebarHeader>
        <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="p-4 text-sm text-muted-foreground">Loading…</div>
        <div
          v-else-if="commands.length === 0 && !editing"
          class="p-4 text-sm text-muted-foreground leading-relaxed"
        >
          No commands yet. Create one — they live in
          <code class="font-mono text-foreground">.claude/commands/</code>
          (project) or
          <code class="font-mono text-foreground">~/.claude/commands/</code>
          (global).
        </div>
        <ul v-else>
          <li
            v-for="cmd in commands"
            :key="`${cmd.scope}:${cmd.id}`"
            class="border-b border-border/50 px-4 py-3 cursor-pointer transition hover:bg-accent/50"
            :class="selectedId === `${cmd.scope}:${cmd.id}` ? 'bg-accent' : ''"
            @click="beginEdit(cmd)"
          >
            <div class="text-sm font-medium truncate font-mono">/{{ cmd.id }}</div>
            <div class="text-xs text-muted-foreground truncate">
              {{ cmd.name !== cmd.id ? cmd.name : '(no title)' }}
            </div>
            <div class="mt-1 text-[10px] tabular-nums">
              <span
                class="px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono"
              >
                {{ cmd.scope }}
              </span>
            </div>
          </li>
        </ul>
        </div>
      </aside>

      <main class="flex-1 overflow-y-auto min-w-0">
        <div
          v-if="!editing"
          class="h-full flex items-center justify-center text-muted-foreground text-sm p-8"
        >
          Select a command to edit, or create a new one.
        </div>
        <div v-else class="p-6 space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1.5">
              <label class="text-xs font-medium">ID (slash command name)</label>
              <input
                v-model="form.id"
                type="text"
                placeholder="my-command"
                :disabled="!isNew"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono disabled:opacity-50"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-medium">Scope</label>
              <select
                v-model="form.scope"
                :disabled="!isNew"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring disabled:opacity-50"
              >
                <option value="project">Project</option>
                <option value="global">Global</option>
              </select>
            </div>
          </div>

          <div v-if="isNew" class="space-y-1.5 border border-border rounded-md p-3 bg-muted/20">
            <label class="text-xs font-medium">Generate with AI</label>
            <div class="flex gap-2">
              <textarea
                v-model="generatePrompt"
                rows="2"
                placeholder="Describe what this command should do…"
                :disabled="generating || saving"
                class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring resize-none"
              />
              <Button
                size="sm"
                :disabled="generating || saving"
                class="self-end"
                @click="generateCommand"
              >
                {{ generating ? 'Generating…' : 'Generate' }}
              </Button>
            </div>
          </div>

          <div class="space-y-1.5">
            <label class="text-xs font-medium">Body (markdown)</label>
            <textarea
              v-model="form.body"
              rows="16"
              placeholder="# My Command&#10;&#10;Describe what this command does…"
              class="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm leading-relaxed focus:outline-none focus:border-ring font-mono resize-none"
            />
            <p class="text-[11px] text-muted-foreground">
              First H1 heading becomes the display name. Use
              <code class="font-mono">$ARGUMENTS</code> to capture input
              after the slash command.
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
                  const cmd = commands.find((x) => `${x.scope}:${x.id}` === selectedId)
                  if (cmd) remove(cmd)
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
</template>
