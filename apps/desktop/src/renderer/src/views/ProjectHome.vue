<script setup lang="ts">
import { ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import SessionsList from './SessionsList.vue'
import SessionDetail from './SessionDetail.vue'
import type { RecentProject, SessionSummary } from '@shared/ipc-contract'

const props = defineProps<{ project: RecentProject }>()
const emit = defineEmits<{ close: [] }>()

const selectedSessionId = ref<string | null>(null)
const refreshTrigger = ref(0)

function selectSession(session: SessionSummary) {
  selectedSessionId.value = session.id
}

function refresh() {
  refreshTrigger.value++
}

watch(
  () => props.project.path,
  () => {
    selectedSessionId.value = null
  },
)
</script>

<template>
  <div class="h-full flex flex-col">
    <header
      class="border-b border-border px-4 py-2 flex items-center gap-3 shrink-0"
    >
      <Button variant="ghost" size="sm" @click="emit('close')">← Back</Button>
      <div class="min-w-0 flex-1">
        <div class="font-medium text-sm truncate">{{ project.name }}</div>
        <div class="text-xs text-muted-foreground truncate font-mono">
          {{ project.path }}
        </div>
      </div>
      <Button variant="ghost" size="sm" @click="refresh">Refresh</Button>
    </header>

    <div class="flex-1 flex min-h-0">
      <aside
        class="w-80 border-r border-border shrink-0 overflow-y-auto bg-card/30"
      >
        <SessionsList
          :project-path="project.path"
          :selected-id="selectedSessionId"
          :refresh-key="refreshTrigger"
          @select="selectSession"
        />
      </aside>
      <main class="flex-1 min-w-0 overflow-y-auto">
        <SessionDetail
          :project-path="project.path"
          :session-id="selectedSessionId"
        />
      </main>
    </div>
  </div>
</template>
