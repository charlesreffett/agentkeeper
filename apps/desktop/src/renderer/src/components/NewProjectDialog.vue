<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import type { RecentProject } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  created: [project: RecentProject]
}>()

const { create, isCreating } = useProjectsQuery()

const name = ref('')
const parentDir = ref('')
const error = ref<string | null>(null)

const dirName = computed(() =>
  name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
)

const fullPath = computed(() =>
  parentDir.value && dirName.value ? `${parentDir.value}/${dirName.value}` : '',
)

const canCreate = computed(() => !!dirName.value && !!parentDir.value)

function reset() {
  name.value = ''
  parentDir.value = ''
  error.value = null
}

watch(() => props.open, (val) => {
  if (val) reset()
})

async function browse() {
  const picked = await window.agentkeeper.projects.pickFolder()
  if (picked) parentDir.value = picked
}

async function handleCreate() {
  if (!canCreate.value) return
  error.value = null
  try {
    const result = await create({ name: name.value.trim(), parentDir: parentDir.value, dirName: dirName.value })
    emit('created', result)
    emit('update:open', false)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create project'
  }
}
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[480px]">
      <DialogHeader>
        <DialogTitle>New Project</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-1">
        <!-- Project name -->
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium">Project name</label>
          <input
            v-model="name"
            type="text"
            placeholder="my-project"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
            @keydown.enter="handleCreate"
            @keydown.escape="emit('update:open', false)"
          />
          <span v-if="dirName" class="text-xs text-muted-foreground">Folder: {{ dirName }}</span>
        </div>

        <!-- Parent folder -->
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium">Parent folder</label>
          <div class="flex gap-2">
            <input
              :value="parentDir"
              type="text"
              readonly
              placeholder="Choose a folder…"
              class="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground cursor-default focus:outline-none"
            />
            <Button variant="outline" size="sm" class="shrink-0" @click="browse">Browse…</Button>
          </div>
        </div>

        <!-- Full path preview -->
        <p v-if="fullPath" class="text-xs text-muted-foreground break-all">{{ fullPath }}</p>

        <!-- Error -->
        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="isCreating" @click="emit('update:open', false)">Cancel</Button>
        <Button :disabled="!canCreate || isCreating" @click="handleCreate">
          {{ isCreating ? 'Creating…' : 'Create project' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
