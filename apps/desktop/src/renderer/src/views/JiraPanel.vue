<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Settings } from 'lucide-vue-next'
import JiraIssueDetail from './JiraIssueDetail.vue'
import JiraSettingsModal from './JiraSettingsModal.vue'
import type { WorkItem } from '@shared/ipc-contract'

const props = defineProps<{
  open: boolean
  projectPath: string
}>()

const emit = defineEmits<{
  close: []
  sessionStarted: [localId: string]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const items = ref<WorkItem[]>([])
const loading = ref(false)
const filter = ref('')
const selectedId = ref<string | null>(null)
const cliMissing = ref(false)
const settingsOpen = ref(false)

const statusLabel: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  closed: 'Closed',
}

const statusClass: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  in_review: 'bg-purple-500/20 text-purple-400',
  done: 'bg-green-500/20 text-green-400',
  closed: 'bg-muted text-muted-foreground',
}

async function loadIssues() {
  loading.value = true
  cliMissing.value = false
  try {
    const all = await window.orchestral.workItems.list()
    items.value = all.filter((i) => i.source === 'jira')
  } catch {
    cliMissing.value = true
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      selectedId.value = null
      filter.value = ''
      await loadIssues()
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

const filtered = computed(() => {
  const q = filter.value.toLowerCase()
  if (!q) return items.value
  return items.value.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      i.externalRef.toLowerCase().includes(q),
  )
})

function onSessionStarted(localId: string) {
  emit('close')
  emit('sessionStarted', localId)
}

let unsub: (() => void) | null = null
onMounted(() => {
  unsub = window.orchestral.plugins.onEvent((event) => {
    if (event === 'plugin.healthy') {
      cliMissing.value = false
      void loadIssues()
    } else if (event === 'plugin.unhealthy') {
      cliMissing.value = true
    }
  })
})
onUnmounted(() => {
  unsub?.()
})
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-2xl w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col max-h-[85vh]">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <span class="font-semibold text-sm">Jira Issues</span>
        <div class="flex items-center gap-2">
          <button
            class="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
            title="Jira settings"
            @click="settingsOpen = true"
          >
            <Settings :size="14" />
          </button>
          <button
            class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
            @click="emit('close')"
          >
            ×
          </button>
        </div>
      </header>

      <div v-if="selectedId" class="flex-1 min-h-0">
        <JiraIssueDetail
          :id="selectedId"
          :project-path="projectPath"
          @back="selectedId = null"
          @session-started="onSessionStarted"
        />
      </div>

      <template v-else>
        <div class="px-4 py-2 border-b border-border shrink-0">
          <input
            v-model="filter"
            type="text"
            placeholder="Filter issues…"
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div class="flex-1 overflow-y-auto min-h-0">
          <div v-if="loading" class="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading…
          </div>

          <div
            v-else-if="cliMissing"
            class="flex items-center justify-center py-12 text-sm text-muted-foreground px-6 text-center"
          >
            Jira CLI not found. Install <code class="mx-1 font-mono text-xs bg-muted px-1 rounded">jira</code> to use this panel.
          </div>

          <div v-else-if="filtered.length === 0" class="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No issues match.
          </div>

          <ul v-else class="divide-y divide-border">
            <li
              v-for="item in filtered"
              :key="item.id"
              class="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 cursor-pointer"
              @click="selectedId = item.id"
            >
              <div class="min-w-0 flex-1">
                <div class="text-xs font-mono text-muted-foreground mb-0.5">{{ item.externalRef }}</div>
                <div class="text-sm truncate">{{ item.title }}</div>
              </div>
              <span
                class="shrink-0 text-xs px-2 py-0.5 rounded-full"
                :class="statusClass[item.status] ?? 'bg-muted text-muted-foreground'"
              >
                {{ statusLabel[item.status] ?? item.status }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </dialog>

  <JiraSettingsModal
    :open="settingsOpen"
    @close="settingsOpen = false"
    @saved="loadIssues"
  />
</template>
