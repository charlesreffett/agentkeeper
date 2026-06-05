<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { queryKeys } from '@/lib/queryKeys'
import type { McpServerEntry, McpServerType } from '@shared/ipc-contract'

const queryClient = useQueryClient()
const { settings } = useSettingsQuery()

const mcpServers = computed<McpServerEntry[]>(() => settings.value?.mcpServers ?? [])

// ─── Add / edit form ──────────────────────────────────────────────────────────

const DEFAULT_FORM = (): Omit<McpServerEntry, 'id'> => ({
  name: '',
  type: 'stdio',
  command: '',
  args: [],
  env: {},
  url: '',
  headers: {},
  enabledByDefault: false,
})

const showForm = ref(false)
const editingId = ref<string | null>(null)
const form = ref(DEFAULT_FORM())
const argsInput = ref('')   // space-separated string bound to textarea
const formError = ref<string | null>(null)

function openAdd() {
  editingId.value = null
  form.value = DEFAULT_FORM()
  argsInput.value = ''
  formError.value = null
  showForm.value = true
}

function openEdit(entry: McpServerEntry) {
  editingId.value = entry.id
  form.value = {
    name: entry.name,
    type: entry.type,
    command: entry.command ?? '',
    args: entry.args ?? [],
    env: entry.env ?? {},
    url: entry.url ?? '',
    headers: entry.headers ?? {},
    enabledByDefault: entry.enabledByDefault,
  }
  argsInput.value = (entry.args ?? []).join(' ')
  formError.value = null
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingId.value = null
  form.value = DEFAULT_FORM()
}

async function saveForm() {
  formError.value = null
  const name = form.value.name.trim()
  if (!name) { formError.value = 'Name is required.'; return }

  if (form.value.type === 'stdio') {
    if (!form.value.command?.trim()) { formError.value = 'Command is required for stdio servers.'; return }
  } else {
    if (!form.value.url?.trim()) { formError.value = 'URL is required for http/sse servers.'; return }
  }

  // Parse args from the space-separated input
  const args = argsInput.value.trim() ? argsInput.value.trim().split(/\s+/) : []

  const current = settings.value?.mcpServers ?? []

  let updated: McpServerEntry[]
  if (editingId.value) {
    updated = current.map((e) =>
      e.id === editingId.value
        ? { ...e, ...form.value, name, args }
        : e,
    )
  } else {
    const newEntry: McpServerEntry = {
      id: crypto.randomUUID(),
      ...form.value,
      name,
      args,
    }
    updated = [...current, newEntry]
  }

  await window.agentkeeper.settings.set({ mcpServers: updated })
  queryClient.setQueryData(queryKeys.settings.app(), { ...settings.value, mcpServers: updated })
  cancelForm()
}

async function removeServer(id: string) {
  const updated = (settings.value?.mcpServers ?? []).filter((e) => e.id !== id)
  await window.agentkeeper.settings.set({ mcpServers: updated })
  queryClient.setQueryData(queryKeys.settings.app(), { ...settings.value, mcpServers: updated })
}

const TYPE_OPTIONS: { value: McpServerType; label: string }[] = [
  { value: 'stdio', label: 'stdio — subprocess' },
  { value: 'http', label: 'http — streaming HTTP' },
  { value: 'sse', label: 'sse — Server-Sent Events' },
]
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-sm font-semibold mb-1">MCP Servers</h2>
      <p class="text-xs text-muted-foreground">
        External MCP servers available to sessions. Toggle individual servers
        when starting a session — or mark one as "enabled by default" to
        pre-check it automatically.
      </p>
    </div>

    <!-- Server list -->
    <div v-if="mcpServers.length > 0" class="space-y-2">
      <div
        v-for="server in mcpServers"
        :key="server.id"
        class="flex items-start gap-3 rounded-md border border-border bg-muted/20 px-3 py-2.5"
      >
        <div class="flex-1 min-w-0 space-y-0.5">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium">{{ server.name }}</span>
            <span class="text-xs text-muted-foreground uppercase tracking-wide">{{ server.type }}</span>
            <span
              v-if="server.enabledByDefault"
              class="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
            >default on</span>
          </div>
          <p class="text-xs text-muted-foreground font-mono truncate">
            <template v-if="server.type === 'stdio'">
              {{ server.command }}{{ server.args?.length ? ' ' + server.args.join(' ') : '' }}
            </template>
            <template v-else>{{ server.url }}</template>
          </p>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded"
            @click="openEdit(server)"
          >Edit</button>
          <button
            class="text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded"
            @click="removeServer(server.id)"
          >Remove</button>
        </div>
      </div>
    </div>

    <p v-else-if="!showForm" class="text-xs text-muted-foreground italic">
      No MCP servers configured yet.
    </p>

    <!-- Add / edit form -->
    <div v-if="showForm" class="rounded-md border border-border bg-muted/10 p-4 space-y-3">
      <h3 class="text-sm font-semibold">{{ editingId ? 'Edit server' : 'Add server' }}</h3>

      <div class="grid grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="e.g. caveman-shrink"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">Type</label>
          <select
            v-model="form.type"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
          >
            <option v-for="t in TYPE_OPTIONS" :key="t.value" :value="t.value">{{ t.label }}</option>
          </select>
        </div>
      </div>

      <!-- stdio fields -->
      <template v-if="form.type === 'stdio'">
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">Command</label>
          <input
            v-model="form.command"
            type="text"
            placeholder="e.g. npx"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-ring"
          />
        </div>
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">Arguments <span class="font-normal">(space-separated)</span></label>
          <input
            v-model="argsInput"
            type="text"
            placeholder="e.g. -y caveman-mcp-server"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-ring"
          />
        </div>
      </template>

      <!-- http / sse fields -->
      <template v-else>
        <div class="space-y-1">
          <label class="text-xs text-muted-foreground">URL</label>
          <input
            v-model="form.url"
            type="text"
            placeholder="e.g. http://localhost:3100/mcp"
            class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-ring"
          />
        </div>
      </template>

      <label class="flex items-center gap-2 cursor-pointer select-none">
        <input
          v-model="form.enabledByDefault"
          type="checkbox"
          class="size-4 rounded border-input"
        />
        <span class="text-sm">Enable by default for new sessions</span>
      </label>

      <p v-if="formError" class="text-xs text-destructive">{{ formError }}</p>

      <div class="flex gap-2">
        <button
          class="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors"
          @click="saveForm"
        >
          {{ editingId ? 'Save changes' : 'Add server' }}
        </button>
        <button
          class="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted transition-colors"
          @click="cancelForm"
        >
          Cancel
        </button>
      </div>
    </div>

    <button
      v-if="!showForm"
      class="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted transition-colors"
      @click="openAdd"
    >
      + Add MCP server
    </button>
  </div>
</template>
