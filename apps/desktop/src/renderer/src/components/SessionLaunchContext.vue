<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Check, ChevronDown, Folder, GitBranch, Search } from '@/components/icons/app-icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { useGitBranches } from '@/composables/useGitBranches'
import type { ScopeOption } from '@/composables/usePageScope'

const props = defineProps<{
  projectPath: string | null
  projects: ScopeOption[]
  branch: string
  useWorktree: boolean
}>()

const emit = defineEmits<{
  'update:projectPath': [value: string]
  'initialize:branch': [value: string]
  'update:branch': [value: string]
  'update:useWorktree': [value: boolean]
  'newProject': []
}>()

const projectOpen = ref(false)
const branchOpen = ref(false)
const projectQuery = ref('')
const branchQuery = ref('')
const projectSearch = ref<HTMLInputElement | null>(null)
const branchSearch = ref<HTMLInputElement | null>(null)
const path = computed(() => props.projectPath)
const { isRepo, branches, currentBranch, isLoading, refetch } = useGitBranches(path)

const selectedProject = computed(() => props.projects.find((p) => p.value === props.projectPath))
const filteredProjects = computed(() => {
  const q = projectQuery.value.trim().toLowerCase()
  return q ? props.projects.filter((p) => `${p.label} ${p.path ?? ''}`.toLowerCase().includes(q)) : props.projects
})
const filteredBranches = computed(() => {
  const q = branchQuery.value.trim().toLowerCase()
  return q ? branches.value.filter((b) => b.name.toLowerCase().includes(q)) : branches.value
})

watch(projectOpen, (open) => {
  if (open) { projectQuery.value = ''; void nextTick(() => projectSearch.value?.focus()) }
})
watch(branchOpen, (open) => {
  if (open) { branchQuery.value = ''; void refetch(); void nextTick(() => branchSearch.value?.focus()) }
})
watch([() => props.projectPath, currentBranch], () => {
  if (props.projectPath && !props.branch && currentBranch.value?.name) emit('initialize:branch', currentBranch.value.name)
}, { immediate: true })

function chooseProject(value: string) {
  emit('update:projectPath', value)
  projectOpen.value = false
}
</script>

<template>
  <div class="flex min-w-0 items-center gap-1">
    <Popover v-model:open="projectOpen">
      <PopoverTrigger as-child>
        <button type="button" class="flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium hover:bg-muted">
          <Folder class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ selectedProject?.label ?? 'Choose project' }}</span>
          <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-[320px] p-1.5">
        <div class="flex items-center gap-2 border-b px-2 pb-1.5">
          <Search class="size-3.5 text-muted-foreground" />
          <input ref="projectSearch" v-model="projectQuery" class="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search projects…" />
        </div>
        <div class="max-h-64 overflow-y-auto py-1">
          <button v-for="project in filteredProjects" :key="project.value" type="button" class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted" @click="chooseProject(project.value)">
            <Check class="mt-0.5 size-3.5 shrink-0" :class="project.value === projectPath ? 'opacity-100' : 'opacity-0'" />
            <span class="min-w-0"><span class="block truncate text-sm">{{ project.label }}</span><span class="block truncate text-[11px] text-muted-foreground">{{ project.path }}</span></span>
          </button>
          <div v-if="!filteredProjects.length" class="px-3 py-5 text-center text-xs text-muted-foreground">No matching projects</div>
        </div>
        <div class="border-t pt-1">
          <button type="button" class="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted" @click="projectOpen = false; emit('newProject')">New project…</button>
        </div>
      </PopoverContent>
    </Popover>

    <div v-if="projectPath && isRepo" class="flex h-8 shrink-0 items-center overflow-hidden rounded-lg border border-border bg-muted/30">
      <Popover v-model:open="branchOpen">
        <PopoverTrigger as-child>
          <button type="button" class="flex h-full max-w-44 items-center gap-1.5 px-2 text-xs hover:bg-muted">
            <GitBranch class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate font-mono">{{ branch || currentBranch?.name || 'Choose branch' }}</span>
            <ChevronDown class="size-3 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" class="w-[360px] p-1.5">
          <div class="flex items-center gap-2 border-b px-2 pb-1.5">
            <Search class="size-3.5 text-muted-foreground" />
            <input ref="branchSearch" v-model="branchQuery" class="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Search branches…" />
          </div>
          <div class="max-h-72 overflow-y-auto py-1">
            <div v-if="isLoading" class="px-3 py-5 text-center text-xs text-muted-foreground">Loading branches…</div>
            <button v-for="item in filteredBranches" :key="item.name" type="button" class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted" @click="emit('update:branch', item.name); branchOpen = false">
              <Check class="size-3.5 shrink-0" :class="item.name === branch ? 'opacity-100' : 'opacity-0'" />
              <span class="min-w-0 flex-1 truncate font-mono text-xs">{{ item.name }}</span>
              <span v-if="item.isCurrent" class="text-[10px] text-muted-foreground">current</span>
              <span v-else-if="item.worktreePath" class="text-[10px] text-muted-foreground">worktree</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <span class="h-4 w-px bg-border" />
      <label class="flex h-full cursor-pointer items-center gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
        <Checkbox :model-value="useWorktree" @update:model-value="emit('update:useWorktree', $event === true)" />
        <span>Worktree</span>
      </label>
    </div>
  </div>
</template>
