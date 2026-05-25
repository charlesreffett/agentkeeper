<script setup lang="ts">
import { ref, watch, onMounted, computed, nextTick } from 'vue'
import {
  FolderOpen,
  ChevronDown,
  GitBranch,
  GitPullRequest,
  Folder,
  Moon,
  PanelRight,
  Plus,
  Pencil,
  X,
  Puzzle,
  Settings,
  Settings2,
  GitCommitHorizontal,
} from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { useLayoutStore } from '@/stores/layout'
import { useRightPanelStore } from '@/stores/rightPanel'
import { useRouter } from 'vue-router'
import { cn } from '@/lib/utils'
import { toast } from 'vue-sonner'
import type { RecentProject } from '@shared/ipc-contract'

const { projects, focusedProject, add, remove, setFocused, rename: renameProject, pickAndAdd } = useProjectsQuery()
const layoutStore = useLayoutStore()
const rightPanelStore = useRightPanelStore()
const router = useRouter()

const branch = ref<string>('—')
const popoverOpen = ref(false)

const renameOpen = ref(false)
const renameTarget = ref<RecentProject | null>(null)
const renameName = ref('')
const renameDirFlag = ref(false)
const renameInput = ref<HTMLInputElement | null>(null)

const focusedName = computed(() => {
  const p = focusedProject.value
  if (!p) return 'No project'
  return p.path.split('/').pop() ?? p.path
})

const sortedProjects = computed(() =>
  [...projects.value].sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)),
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

const showNewBranch = ref(false)
const newBranchName = ref('')
const newBranchInput = ref<HTMLInputElement | null>(null)

async function gitPull() {
  const path = focusedProject.value?.path
  if (!path) return
  try {
    await (window.agentkeeper as any).git.pull(path)
    toast.success('git pull succeeded')
    await loadBranch(path)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'git pull failed')
  }
}

function openCommit() {
  if (!layoutStore.rightPanelOpen) layoutStore.toggleRightPanel()
  rightPanelStore.openGitChanges()
}

function openNewBranch() {
  newBranchName.value = ''
  showNewBranch.value = true
  nextTick(() => newBranchInput.value?.focus())
}

function cancelNewBranch() {
  showNewBranch.value = false
  newBranchName.value = ''
}

async function confirmNewBranch() {
  const path = focusedProject.value?.path
  const name = newBranchName.value.trim()
  if (!path || !name) return
  try {
    await (window.agentkeeper as any).git.createBranch(path, name)
    branch.value = name
    showNewBranch.value = false
    newBranchName.value = ''
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to create branch')
  }
}

async function openLocalProject() {
  const path = await window.agentkeeper.projects.pickFolder()
  if (path) {
    await add(path)
    await setFocused(path)
  }
  popoverOpen.value = false
}

function selectProject(path: string) {
  void setFocused(path)
  popoverOpen.value = false
}

function openRenameDialog(project: RecentProject) {
  popoverOpen.value = false
  renameTarget.value = project
  renameName.value = project.name
  renameDirFlag.value = false
  renameOpen.value = true
  nextTick(() => renameInput.value?.select())
}

function cancelRename() {
  renameOpen.value = false
  renameTarget.value = null
}

async function confirmRename() {
  if (!renameTarget.value || !renameName.value.trim()) return
  await renameProject({ oldPath: renameTarget.value.path, newName: renameName.value.trim(), renameDir: renameDirFlag.value })
  renameOpen.value = false
  renameTarget.value = null
}

onMounted(() => loadBranch(focusedProject.value?.path))
watch(
  () => focusedProject.value?.path,
  (path) => loadBranch(path),
)
</script>

<template>
  <header class="h-11 border-b bg-background flex items-center pr-3 pl-2 gap-2 shrink-0" style="-webkit-app-region: drag">
    <SidebarTrigger style="-webkit-app-region: no-drag" />
    <Separator orientation="vertical" class="h-4" />
    <!-- Project picker -->
    <Popover v-model:open="popoverOpen">
      <PopoverTrigger as-child>
        <Button variant="ghost" class="h-7 px-2 text-sm font-medium gap-1.5" style="-webkit-app-region: no-drag">
          <FolderOpen class="h-4 w-4 text-muted-foreground" />
          <span>{{ focusedName }}</span>
          <ChevronDown class="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-72 p-1" style="-webkit-app-region: no-drag">
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
        <div class="flex items-center justify-between px-2 py-1">
          <span class="text-xs text-muted-foreground font-medium">Projects</span>
          <button
            class="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="Add project"
            @click="void pickAndAdd()"
          >
            <Plus class="h-3 w-3" />
          </button>
        </div>
        <div v-if="sortedProjects.length === 0" class="px-2 py-1.5 text-xs text-muted-foreground">
          No projects
        </div>
        <div class="max-h-64 overflow-y-auto">
          <div
            v-for="project in sortedProjects"
            :key="project.path"
            class="group flex items-center w-full px-2 py-1.5 text-sm rounded transition-colors hover:bg-accent"
            :class="{ 'bg-accent/50': focusedProject?.path === project.path }"
          >
            <button
              class="flex items-center gap-2 flex-1 min-w-0 text-left"
              :title="project.path"
              @click="selectProject(project.path)"
            >
              <FolderOpen class="h-4 w-4 shrink-0 text-muted-foreground" />
              <span class="truncate">{{ project.path.split('/').pop() ?? project.path }}</span>
            </button>
            <button
              class="size-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-background transition-colors shrink-0"
              title="Rename"
              @click.stop="openRenameDialog(project)"
            >
              <Pencil class="h-3 w-3" />
            </button>
            <button
              class="size-5 flex items-center justify-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-background transition-colors shrink-0"
              title="Remove"
              @click.stop="void remove(project.path)"
            >
              <X class="h-3 w-3" />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>

    <Separator orientation="vertical" class="h-4 mx-1" />

    <!-- Branch dropdown -->
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" class="h-7 px-2 text-xs gap-1.5 text-muted-foreground font-normal" style="-webkit-app-region: no-drag">
          <GitBranch class="h-3.5 w-3.5 shrink-0" />
          <span>{{ branch }}</span>
          <ChevronDown class="h-3 w-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" style="-webkit-app-region: no-drag">
        <DropdownMenuItem class="gap-2" @click="gitPull">
          <GitPullRequest class="h-4 w-4" />
          git pull
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="gap-2" @click="openCommit">
          <GitCommitHorizontal class="h-4 w-4" />
          Commit
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem class="gap-2" @click="openNewBranch">
          <Plus class="h-4 w-4" />
          New Branch…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <!-- Right side -->
    <div class="ml-auto flex items-center gap-1">
      <!-- Settings action menu -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-7 w-7"
            style="-webkit-app-region: no-drag"
          >
            <Settings class="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-[300px]" style="-webkit-app-region: no-drag">
          <DropdownMenuItem class="flex items-center justify-between px-3 py-2.5" @select.prevent="void layoutStore.toggleTheme()">
            <div class="flex items-center gap-2">
              <Moon
                class="h-4 w-4 transition-colors"
                :class="layoutStore.theme === 'dark' ? 'fill-white' : 'fill-transparent'"
              />
              <span>Dark Mode</span>
            </div>
            <div
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors pointer-events-none"
              :class="layoutStore.theme === 'dark' ? 'bg-primary' : 'bg-muted'"
            >
              <div
                class="h-3.5 w-3.5 rounded-full bg-background shadow transition-transform"
                :class="layoutStore.theme === 'dark' ? 'translate-x-[18px]' : 'translate-x-[2px]'"
              />
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem class="px-3 py-2.5" @click="void router.push('/plugins')">
            <Puzzle class="h-4 w-4 mr-2" />
            Plugins
          </DropdownMenuItem>
          <DropdownMenuItem class="px-3 py-2.5" @click="void router.push('/settings')">
            <Settings2 class="h-4 w-4 mr-2" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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

  <Teleport to="body">
    <!-- Rename dialog -->
    <div v-if="renameOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/20 backdrop-blur-md" @click="cancelRename" />
      <div class="relative bg-card border border-border rounded-lg shadow-xl p-4 w-72 flex flex-col gap-3">
        <div class="text-sm font-medium">Rename project</div>
        <input
          ref="renameInput"
          v-model="renameName"
          type="text"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          @keydown.enter="confirmRename"
          @keydown.escape="cancelRename"
        />
        <label class="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
          <input v-model="renameDirFlag" type="checkbox" class="size-4 rounded border-input" />
          Also rename the directory on disk
        </label>
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="cancelRename"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="confirmRename"
          >
            Rename
          </button>
        </div>
      </div>
    </div>
    <!-- New Branch dialog -->
    <div v-if="showNewBranch" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/20 backdrop-blur-md" @click="cancelNewBranch" />
      <div class="relative bg-card border border-border rounded-lg shadow-xl p-4 w-72 flex flex-col gap-3">
        <div class="text-sm font-medium">New branch</div>
        <input
          ref="newBranchInput"
          v-model="newBranchName"
          type="text"
          placeholder="branch-name"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring"
          @keydown.enter="confirmNewBranch"
          @keydown.escape="cancelNewBranch"
        />
        <div class="flex justify-end gap-2">
          <button
            class="px-3 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="cancelNewBranch"
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 rounded text-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="!newBranchName.trim()"
            @click="confirmNewBranch"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
