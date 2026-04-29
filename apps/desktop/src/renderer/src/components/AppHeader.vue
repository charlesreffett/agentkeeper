<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import {
  FolderOpen,
  ChevronDown,
  GitBranch,
  Folder,
  Sun,
  Moon,
  PanelRight,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useProjectsStore } from '@/stores/projects'
import { useLayoutStore } from '@/stores/layout'
import { cn } from '@/lib/utils'

const projectsStore = useProjectsStore()
const layoutStore = useLayoutStore()

const branch = ref<string>('—')
const popoverOpen = ref(false)

const focusedName = computed(() => {
  const p = projectsStore.focusedProject
  if (!p) return 'No project'
  return p.path.split('/').pop() ?? p.path
})

const recentProjects = computed(() =>
  [...projectsStore.projects]
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, 3),
)

async function loadBranch(path: string | undefined) {
  if (!path) {
    branch.value = '—'
    return
  }
  try {
    const result = await (window.agentkeeper as any).git?.getBranch(path)
    branch.value = result ?? '—'
  } catch {
    branch.value = '—'
  }
}

async function openLocalProject() {
  const path = await window.agentkeeper.projects.pickFolder()
  if (path) {
    await projectsStore.add(path)
    await projectsStore.setFocused(path)
  }
  popoverOpen.value = false
}

function selectProject(path: string) {
  void projectsStore.setFocused(path)
  popoverOpen.value = false
}

onMounted(() => loadBranch(projectsStore.focusedProject?.path))
watch(
  () => projectsStore.focusedProject?.path,
  (path) => loadBranch(path),
)
</script>

<template>
  <header class="h-11 border-b bg-background flex items-center pr-3 pl-[74px] gap-2 shrink-0" style="-webkit-app-region: drag">
    <!-- Project picker -->
    <Popover v-model:open="popoverOpen">
      <PopoverTrigger as-child>
        <Button variant="ghost" class="h-7 px-2 text-sm font-medium gap-1.5" style="-webkit-app-region: no-drag">
          <FolderOpen class="h-4 w-4 text-muted-foreground" />
          <span>{{ focusedName }}</span>
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-64 p-1" style="-webkit-app-region: no-drag">
        <button
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground transition-colors"
          @click="openLocalProject"
        >
          <Folder class="h-4 w-4" />
          Open local project
        </button>
        <button
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded opacity-50 pointer-events-none"
        >
          <GitBranch class="h-4 w-4" />
          Clone from git
        </button>
        <Separator class="my-1" />
        <div v-if="recentProjects.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
          No recent projects
        </div>
        <button
          v-for="project in recentProjects"
          :key="project.path"
          class="flex items-center gap-2 w-full px-2 py-1.5 text-sm rounded hover:bg-accent hover:text-accent-foreground transition-colors"
          :class="{ 'bg-accent/50': projectsStore.focusedProject?.path === project.path }"
          :title="project.path"
          @click="selectProject(project.path)"
        >
          <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
          <span class="truncate">{{ project.path.split('/').pop() ?? project.path }}</span>
        </button>
      </PopoverContent>
    </Popover>

    <Separator orientation="vertical" class="h-4 mx-1" />

    <!-- Branch display -->
    <div class="flex items-center gap-1.5">
      <GitBranch class="h-3.5 w-3.5 text-muted-foreground" />
      <span class="text-xs text-muted-foreground">{{ branch }}</span>
    </div>

    <!-- Right side -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Theme toggle -->
      <Button
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :title="layoutStore.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
        style="-webkit-app-region: no-drag"
        @click="void layoutStore.toggleTheme()"
      >
        <Sun v-if="layoutStore.theme === 'dark'" class="h-4 w-4" />
        <Moon v-else class="h-4 w-4" />
      </Button>

      <!-- Right panel toggle -->
      <Button
        variant="ghost"
        size="icon"
        :class="cn('h-7 w-7', layoutStore.rightPanelOpen && 'bg-accent text-accent-foreground')"
        style="-webkit-app-region: no-drag"
        @click="layoutStore.toggleRightPanel()"
      >
        <PanelRight class="h-4 w-4" />
      </Button>
    </div>
  </header>
</template>
