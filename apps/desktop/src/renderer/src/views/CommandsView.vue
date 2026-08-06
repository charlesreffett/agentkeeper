<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { Button } from '@/components/ui/button'
import type { SlashCommand } from '@shared/ipc-contract'
import { useClaudeAuth } from '@/composables/useClaudeAuth'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePageScope, SCOPE_ALL } from '@/composables/usePageScope'
import { useCommandsDataStore } from '@/stores/commandsData'
import PageHeader from '@/components/PageHeader.vue'
import SidebarHeader from '@/components/SidebarHeader.vue'
import ScopeBar from '@/components/ScopeBar.vue'
import { Terminal } from 'lucide-vue-next'

const { scope, options, label, color, setScope, pickAndAdd, isAll, isGlobal, isProject, currentProject } =
  usePageScope('commands', { includeGlobal: true })
const { projects } = useProjectsQuery()
const queryClient = useQueryClient()
const commandsDataStore = useCommandsDataStore()
// Scoped load input: project → its path (project + global); Global/All → ''
// (global + plugin for the store; the union query below serves All).
const projectPath = computed(() =>
  isAll.value || isGlobal.value ? '' : isProject.value ? currentProject.value?.path ?? '' : '',
)
const { handleAuthError } = useClaudeAuth()

// All scope = union of global + every project's commands (+ plugin commands,
// which are global by nature), deduped by file path.
const { data: allCommands, isLoading: allLoading } = useQuery({
  queryKey: computed(() => ['commands', 'list', SCOPE_ALL, projects.value.map((p) => p.path).sort().join('|')]),
  enabled: isAll,
  queryFn: async () => {
    const paths = ['', ...projects.value.map((p) => p.path)]
    const lists = await Promise.all(paths.map((p) => window.agentkeeper.commands.list(p)))
    const byPath = new Map<string, SlashCommand>()
    for (const list of lists) for (const c of list) byPath.set(c.path, c)
    return Array.from(byPath.values())
  },
})

const commands = computed<SlashCommand[]>(() =>
  isAll.value ? allCommands.value ?? [] : commandsDataStore.commands,
)
const selectedCommand = computed(() =>
  selectedId.value ? commands.value.find((c) => `${c.scope}:${c.id}` === selectedId.value) ?? null : null,
)
const loading = computed(() => (isAll.value ? allLoading.value : commandsDataStore.loading))
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
    if (isAll.value) {
      await queryClient.invalidateQueries({ queryKey: ['commands', 'list', SCOPE_ALL] })
    } else {
      commandsDataStore.invalidate()
      await commandsDataStore.load(projectPath.value)
    }
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
  }
}

function beginNew() {
  selectedId.value = null
  isNew.value = true
  editing.value = true
  // Global/All scopes have no project to write to — new commands go global.
  form.value = { id: '', scope: isGlobal.value || isAll.value ? 'global' : 'project', body: '' }
  generatePrompt.value = ''
  message.value = null
}

function beginEdit(cmd: SlashCommand) {
  if (cmd.scope === 'plugin') {
    selectedId.value = `${cmd.scope}:${cmd.id}`
    editing.value = false
    return
  }
  selectedId.value = `${cmd.scope}:${cmd.id}`
  isNew.value = false
  editing.value = true
  form.value = { id: cmd.id, scope: cmd.scope as 'project' | 'global', body: cmd.body }
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
  () => scope.value,
  async () => {
    editing.value = false
    selectedId.value = null
    await refresh()
  },
)

onMounted(async () => {
  editing.value = false
  selectedId.value = null
  await refresh()
})
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Commands">
      <template #actions>
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
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
            <div class="mt-1 flex items-center gap-1 text-[10px] tabular-nums">
              <span
                class="px-1.5 py-0.5 rounded font-mono"
                :class="cmd.scope === 'plugin'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-muted/60 text-muted-foreground'"
              >
                {{ cmd.scope === 'plugin' ? (cmd.pluginName ?? 'plugin') : cmd.scope }}
              </span>
              <span v-if="cmd.scope === 'plugin'" class="text-muted-foreground">read-only</span>
            </div>
          </li>
        </ul>
        </div>
      </aside>

      <main class="flex-1 overflow-y-auto min-w-0">
        <!-- Plugin command — read-only view -->
        <div
          v-if="!editing && selectedCommand?.scope === 'plugin'"
          class="p-6 space-y-3"
        >
          <div class="flex items-center gap-2">
            <span class="font-mono text-lg font-semibold">/{{ selectedCommand.id }}</span>
            <span class="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {{ selectedCommand.pluginName ?? 'plugin' }}
            </span>
          </div>
          <p class="text-xs text-muted-foreground">
            Contributed by an installed Claude Code plugin. Available in all AgentKeeper sessions — use it by typing
            <code class="font-mono">/{{ selectedCommand.id }}</code> in the session input.
          </p>
          <pre class="rounded-md border border-border bg-muted/20 p-4 text-xs font-mono whitespace-pre-wrap leading-relaxed">{{ selectedCommand.body }}</pre>
        </div>
        <div
          v-else-if="!editing"
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
