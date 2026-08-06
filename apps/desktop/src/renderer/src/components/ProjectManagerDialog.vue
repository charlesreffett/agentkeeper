<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderPlus, FolderOpen, Pencil, X } from 'lucide-vue-next'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { projectColor } from '@/lib/projectColor'
import type { RecentProject } from '@shared/ipc-contract'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const { projects, add, remove, rename, create, isCreating, pickAndAdd } = useProjectsQuery()

const error = ref<string | null>(null)

const renaming = ref<RecentProject | null>(null)
const renameValue = ref('')

const newName = ref('')
const newParentDir = ref('')

const dirName = computed(() =>
  newName.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
)
const canCreate = computed(() => !!dirName.value && !!newParentDir.value)

watch(
  () => props.open,
  (val) => {
    if (val) {
      error.value = null
      renaming.value = null
      newName.value = ''
      newParentDir.value = ''
    }
  },
)

async function handleOpen() {
  await pickAndAdd()
}

async function browseParent() {
  const picked = await window.agentkeeper.projects.pickFolder()
  if (picked) newParentDir.value = picked
}

async function handleCreate() {
  if (!canCreate.value) return
  error.value = null
  try {
    await create({ name: newName.value.trim(), parentDir: newParentDir.value, dirName: dirName.value })
    newName.value = ''
    newParentDir.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to create project'
  }
}

function startRename(project: RecentProject) {
  renaming.value = project
  renameValue.value = project.name
}

async function confirmRename() {
  if (!renaming.value || !renameValue.value.trim()) return
  error.value = null
  try {
    await rename({ oldPath: renaming.value.path, newName: renameValue.value.trim(), renameDir: false })
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to rename project'
  }
  renaming.value = null
}

async function removeProject(project: RecentProject) {
  // eslint-disable-next-line no-alert
  if (!confirm(`Remove "${project.name}" from AgentKeeper? Files on disk are untouched.`)) return
  await remove(project.path)
}
</script>

<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="w-[480px]">
      <DialogHeader>
        <DialogTitle>Manage projects</DialogTitle>
      </DialogHeader>

      <div class="flex flex-col gap-4 py-1 max-h-[60vh]">
        <!-- Add / create actions -->
        <div class="flex gap-2">
          <Button variant="outline" size="sm" class="gap-1.5" @click="handleOpen">
            <FolderOpen class="size-3.5" />
            Open local project
          </Button>
          <Button variant="outline" size="sm" class="gap-1.5" @click="browseParent">
            <FolderPlus class="size-3.5" />
            New project
          </Button>
        </div>

        <!-- Create form -->
        <div
          v-if="newParentDir || newName"
          class="rounded-md border border-border bg-muted/20 p-3 space-y-2"
        >
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium">Project name</label>
            <input
              v-model="newName"
              type="text"
              placeholder="my-project"
              class="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:border-ring"
            />
            <span v-if="dirName" class="text-xs text-muted-foreground">Folder: {{ dirName }}</span>
          </div>
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium">Parent folder</label>
            <div class="flex gap-2">
              <input
                :value="newParentDir"
                type="text"
                readonly
                placeholder="Choose a folder…"
                class="flex-1 rounded-md border border-input bg-muted px-3 py-1.5 text-sm text-muted-foreground cursor-default focus:outline-none"
              />
              <Button variant="outline" size="sm" class="shrink-0" @click="browseParent">Browse…</Button>
            </div>
          </div>
          <p v-if="newParentDir && dirName" class="text-xs text-muted-foreground break-all">
            {{ newParentDir }}/{{ dirName }}
          </p>
          <Button size="sm" :disabled="!canCreate || isCreating" @click="handleCreate">
            {{ isCreating ? 'Creating…' : 'Create project' }}
          </Button>
        </div>

        <!-- Project list -->
        <div class="flex-1 min-h-0 overflow-y-auto rounded-md border border-border divide-y divide-border/50">
          <div v-if="projects.length === 0" class="p-4 text-sm text-muted-foreground">
            No projects yet. Open or create one to get started.
          </div>
          <div
            v-for="project in projects"
            :key="project.path"
            class="flex items-center gap-2 px-3 py-2"
          >
            <span
              class="size-2 rounded-full shrink-0"
              :style="{ backgroundColor: projectColor(project.name) }"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{{ project.name }}</div>
              <div class="text-[10px] text-muted-foreground font-mono truncate">
                {{ project.path }}
              </div>
            </div>
            <template v-if="renaming?.path === project.path">
              <input
                v-model="renameValue"
                type="text"
                class="w-32 rounded-md border border-input bg-background px-2 py-1 text-sm focus:outline-none focus:border-ring"
                @keydown.enter="confirmRename"
                @keydown.escape="renaming = null"
              />
              <Button size="sm" @click="confirmRename">Save</Button>
              <Button size="sm" variant="ghost" @click="renaming = null">Cancel</Button>
            </template>
            <template v-else>
              <button
                class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Rename"
                @click="startRename(project)"
              >
                <Pencil class="size-3.5" />
              </button>
              <button
                class="size-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                title="Remove"
                @click="removeProject(project)"
              >
                <X class="size-3.5" />
              </button>
            </template>
          </div>
        </div>

        <p v-if="error" class="text-xs text-destructive">{{ error }}</p>
      </div>
    </DialogContent>
  </Dialog>
</template>
