<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import type { RecentProject } from '@shared/ipc-contract'

const props = defineProps<{
  open: boolean
  preselected?: string | null
}>()

const emit = defineEmits<{
  confirm: [project: RecentProject]
  cancel: []
}>()

const { projects, focusedProject, pickAndAdd } = useProjectsQuery()
const dialog = ref<HTMLDialogElement | null>(null)
const selected = ref<RecentProject | null>(null)
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return projects.value
  return projects.value.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q) ||
      (p.repo ?? '').toLowerCase().includes(q),
  )
})

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      search.value = ''
      const target = props.preselected
        ? projects.value.find((p) => p.path === props.preselected) ?? null
        : null
      selected.value = target ?? focusedProject.value
      await nextTick()
      dialog.value?.showModal()
    } else {
      dialog.value?.close()
    }
  },
)

async function addAndSelect() {
  const before = projects.value.map((p) => p.path)
  await pickAndAdd()
  const added = projects.value.find((p) => !before.includes(p.path))
  if (added) selected.value = added
}

function confirm() {
  if (!selected.value) return
  emit('confirm', selected.value)
}
</script>

<template>
  <dialog
    ref="dialog"
    class="rounded-lg p-0 bg-popover text-foreground border border-popover-border backdrop:bg-black/25 backdrop:backdrop-blur-md max-w-md w-full shadow-dialog"
    @close="emit('cancel')"
    @cancel="emit('cancel')"
  >
    <div class="p-5 space-y-4">
      <header class="flex items-center justify-between">
        <h2 class="text-base font-semibold">Select project</h2>
      </header>

      <input
        v-model="search"
        type="text"
        placeholder="Search…"
        class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
      />

      <div class="max-h-60 overflow-y-auto space-y-0.5">
        <div
          v-if="filtered.length === 0"
          class="py-4 text-center text-sm text-muted-foreground"
        >
          No projects found.
        </div>
        <button
          v-for="project in filtered"
          :key="project.path"
          class="w-full text-left px-3 py-2.5 rounded-md transition-colors"
          :class="
            selected?.path === project.path
              ? 'bg-primary/15 text-foreground'
              : 'hover:bg-muted/50 text-foreground'
          "
          @click="selected = project"
        >
          <div class="text-sm font-medium truncate">{{ project.name }}</div>
          <div class="text-xs text-muted-foreground font-mono truncate">
            {{ project.repo ?? project.path }}
          </div>
        </button>
      </div>

      <button
        class="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
        @click="void addAndSelect()"
      >
        + Add new project
      </button>

      <footer class="flex items-center justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" @click="emit('cancel')">Cancel</Button>
        <Button size="sm" :disabled="!selected" @click="confirm">Confirm</Button>
      </footer>
    </div>
  </dialog>
</template>
