<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/sessions'
import type { WorkItem } from '@shared/ipc-contract'

const props = defineProps<{
  id: string
  projectPath: string
}>()

const emit = defineEmits<{
  back: []
  sessionStarted: [localId: string]
}>()

const sessionStore = useSessionStore()
const item = ref<WorkItem | null>(null)
const loading = ref(true)
const startError = ref<string | null>(null)

onMounted(async () => {
  try {
    item.value = (await window.orchestral.workItems.get(props.id)) ?? null
  } finally {
    loading.value = false
  }
})

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

async function startSession() {
  if (!item.value) return
  startError.value = null
  try {
    const localId = await sessionStore.start({
      projectPath: props.projectPath,
      initialPrompt: '',
      workItemId: item.value.id,
    })
    emit('sessionStarted', localId)
  } catch (err) {
    startError.value = err instanceof Error ? err.message : String(err)
  }
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
      <Button variant="ghost" size="sm" @click="emit('back')">← Back</Button>
      <span class="text-sm font-medium text-muted-foreground">Issue detail</span>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      Loading…
    </div>

    <div v-else-if="!item" class="flex-1 flex items-center justify-center text-muted-foreground text-sm">
      Issue not found.
    </div>

    <div v-else class="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-muted-foreground mb-1">{{ item.externalRef }}</div>
          <h2 class="text-sm font-semibold leading-snug">{{ item.title }}</h2>
        </div>
        <span
          class="shrink-0 text-xs px-2 py-0.5 rounded-full"
          :class="statusClass[item.status] ?? 'bg-muted text-muted-foreground'"
        >
          {{ statusLabel[item.status] ?? item.status }}
        </span>
      </div>

      <div v-if="item.assignee" class="text-xs text-muted-foreground">
        Assignee: {{ item.assignee }}
      </div>

      <div v-if="item.body" class="text-xs text-foreground/80 whitespace-pre-wrap font-mono bg-muted/30 rounded p-3">
        {{ item.body }}
      </div>

      <div v-if="startError" class="text-xs text-destructive bg-destructive/5 rounded p-2">
        {{ startError }}
      </div>

      <Button size="sm" @click="startSession">Start session from this issue</Button>
    </div>
  </div>
</template>
