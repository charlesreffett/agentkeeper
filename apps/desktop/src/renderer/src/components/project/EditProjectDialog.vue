<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Folder, FolderOpen } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import type { RecentProject } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean; project: RecentProject | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [project: RecentProject] }>()
const { update, isUpdating } = useProjectsQuery()

const name = ref('')
const sourcePath = ref('')
const error = ref<string | null>(null)
const canSave = computed(() => Boolean(name.value.trim() && sourcePath.value && props.project))

watch(() => [props.open, props.project] as const, ([open, project]) => {
  if (!open || !project) return
  name.value = project.name
  sourcePath.value = project.path
  error.value = null
}, { immediate: true })

async function chooseFolder() {
  const picked = await window.agentkeeper.projects.pickFolder()
  if (picked) sourcePath.value = picked
}

async function save() {
  if (!props.project || !canSave.value || isUpdating.value) return
  error.value = null
  try {
    const saved = await update({ oldPath: props.project.path, name: name.value.trim(), sourcePath: sourcePath.value })
    emit('saved', saved)
    emit('update:open', false)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'Failed to update project'
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[520px]">
      <DialogHeader>
        <DialogTitle>Edit project</DialogTitle>
      </DialogHeader>

      <form class="space-y-5 py-2" @submit.prevent="save">
        <div class="space-y-2">
          <label for="edit-project-name" class="text-sm font-medium">Project name</label>
          <div class="relative">
            <Folder class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="edit-project-name" v-model="name" class="pl-9" autofocus />
          </div>
          <p class="text-xs text-muted-foreground">This name is only used inside AgentKeeper.</p>
        </div>

        <div class="space-y-2">
          <label class="text-sm font-medium">Source folder</label>
          <button type="button" class="flex w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-left text-sm hover:bg-accent" @click="chooseFolder">
            <FolderOpen class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ sourcePath }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">Choose…</span>
          </button>
          <p class="text-xs text-muted-foreground">Changing this does not move or rename files on disk.</p>
        </div>

        <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      </form>

      <DialogFooter>
        <Button variant="outline" :disabled="isUpdating" @click="emit('update:open', false)">Cancel</Button>
        <Button :disabled="!canSave || isUpdating" @click="save">{{ isUpdating ? 'Saving…' : 'Save' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
