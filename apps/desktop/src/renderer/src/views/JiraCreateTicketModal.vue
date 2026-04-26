<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import type { WorkItem } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  close: []
  created: [item: WorkItem]
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const summary = ref('')
const issueType = ref('Task')
const priority = ref('')
const description = ref('')
const saving = ref(false)
const saveError = ref<string | null>(null)

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      summary.value = ''
      issueType.value = 'Task'
      priority.value = ''
      description.value = ''
      saving.value = false
      saveError.value = null
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

async function submit() {
  if (!summary.value.trim()) return
  saving.value = true
  saveError.value = null
  try {
    const item = await window.orchestral.workItems.create({
      summary: summary.value.trim(),
      issueType: issueType.value || undefined,
      priority: priority.value || undefined,
      description: description.value.trim() || undefined,
    })
    emit('created', item)
    emit('close')
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : String(err)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-card text-foreground border border-border backdrop:bg-black/60 max-w-md w-full shadow-xl"
    @close="emit('close')"
    @cancel="emit('close')"
  >
    <div class="flex flex-col">
      <header class="flex items-center justify-between px-4 py-3 border-b border-border">
        <span class="font-semibold text-sm">Create Ticket</span>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
          @click="emit('close')"
        >
          ×
        </button>
      </header>

      <form class="p-4 space-y-4" @submit.prevent="submit">
        <div class="space-y-1.5">
          <label class="text-xs font-medium text-foreground" for="create-summary">
            Summary <span class="text-destructive">*</span>
          </label>
          <input
            id="create-summary"
            v-model="summary"
            type="text"
            placeholder="Brief description of the issue"
            required
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground" for="create-type">Issue Type</label>
            <select
              id="create-type"
              v-model="issueType"
              class="w-full bg-background border border-border rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="Task">Task</option>
              <option value="Story">Story</option>
              <option value="Bug">Bug</option>
              <option value="Sub-task">Sub-task</option>
            </select>
          </div>
          <div class="space-y-1.5">
            <label class="text-xs font-medium text-foreground" for="create-priority">Priority</label>
            <select
              id="create-priority"
              v-model="priority"
              class="w-full bg-background border border-border rounded px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">— none —</option>
              <option value="Highest">Highest</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
              <option value="Lowest">Lowest</option>
            </select>
          </div>
        </div>

        <div class="space-y-1.5">
          <label class="text-xs font-medium text-foreground" for="create-desc">Description</label>
          <textarea
            id="create-desc"
            v-model="description"
            rows="4"
            placeholder="Optional description…"
            class="w-full bg-background border border-border rounded px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
          />
        </div>

        <div v-if="saveError" class="text-xs text-destructive">{{ saveError }}</div>

        <div class="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" @click="emit('close')">Cancel</Button>
          <Button type="submit" size="sm" :disabled="saving || !summary.trim()">
            {{ saving ? 'Creating…' : 'Create' }}
          </Button>
        </div>
      </form>
    </div>
  </dialog>
</template>
