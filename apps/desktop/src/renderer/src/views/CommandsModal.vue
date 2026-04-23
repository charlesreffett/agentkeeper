<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { SlashCommand } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean; projectPath: string }>()
const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)

const commands = ref<SlashCommand[]>([])
const loading = ref(false)
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

async function refresh() {
  loading.value = true
  message.value = null
  try {
    commands.value = await window.orchestral.commands.list(props.projectPath)
  } catch (e) {
    message.value = e instanceof Error ? e.message : String(e)
    commands.value = []
  } finally {
    loading.value = false
  }
}

function beginNew() {
  selectedId.value = null
  isNew.value = true
  editing.value = true
  form.value = { id: '', scope: 'project', body: '' }
}

function beginEdit(cmd: SlashCommand) {
  selectedId.value = cmd.id
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
    await window.orchestral.commands.save(
      form.value.scope,
      props.projectPath,
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
    await window.orchestral.commands.remove(cmd)
    await refresh()
    if (selectedId.value === cmd.id) cancelEdit()
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
        <h2 class="text-lg font-semibold">Commands</h2>
        <div class="flex items-center gap-2">
          <Button size="sm" @click="beginNew">New command</Button>
          <Button variant="ghost" size="sm" @click="emit('close')">Close</Button>
        </div>
      </header>

      <div class="flex min-h-0 flex-1">
        <aside
          class="w-64 border-r border-border shrink-0 overflow-y-auto bg-card/30"
        >
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
              :class="selectedId === cmd.id ? 'bg-accent' : ''"
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
                  class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
                >
                  <option value="project">Project</option>
                  <option value="global">Global</option>
                </select>
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
                    const cmd = commands.find((x) => x.id === selectedId)
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
  </dialog>
</template>
