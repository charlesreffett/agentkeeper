<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { LayoutDashboard, Grid, GitPullRequest, Layers, FolderOpen, Plus, Network, Bot, Wand2, Terminal, Settings2, Map } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { RecentProject } from '@shared/ipc-contract'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { usePluginHealth } from '@/composables/usePluginHealth'
import { useProjectsStore } from '@/stores/projects'

const router = useRouter()
const route = useRoute()
const uiStore = useUIContributionsStore()
const projectsStore = useProjectsStore()
const { isHealthy: githubHealthy } = usePluginHealth('github')

// ─── Context menu ──────────────────────────────────────────────────────────
const ctxProject = ref<RecentProject | null>(null)
const ctxPos = ref({ x: 0, y: 0 })
const ctxOpen = ref(false)

function openContextMenu(event: MouseEvent, project: RecentProject) {
  ctxProject.value = project
  ctxPos.value = { x: event.clientX, y: event.clientY }
  ctxOpen.value = true
}

function closeContextMenu() {
  ctxOpen.value = false
  ctxProject.value = null
}

function removeProject(project: RecentProject) {
  closeContextMenu()
  void projectsStore.remove(project.path)
}

// ─── Rename dialog ─────────────────────────────────────────────────────────
const renameOpen = ref(false)
const renameTarget = ref<RecentProject | null>(null)
const renameName = ref('')
const renameDirFlag = ref(false)
const renameInput = ref<HTMLInputElement | null>(null)

function openRenameDialog(project: RecentProject) {
  closeContextMenu()
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
  await projectsStore.rename(renameTarget.value.path, renameName.value.trim(), renameDirFlag.value)
  renameOpen.value = false
  renameTarget.value = null
}

const iconMap: Record<string, Component> = {
  LayoutDashboard,
  Grid,
  GitPullRequest,
  Layers,
  FolderOpen,
  Network,
  Bot,
  Wand2,
  Terminal,
  Settings2,
  Map,
}

const coreItems = [
  { id: 'sessions', label: 'Sessions', icon: 'LayoutDashboard', path: '/sessions' },
  { id: 'monitor', label: 'Monitor', icon: 'Grid', path: '/monitor' },
  { id: 'planner', label: 'Planner', icon: 'Map', path: '/planner' },
  { id: 'projects', label: 'Projects', icon: 'FolderOpen', path: '/project' },
]

const workspaceItems = [
  { id: 'agencies', label: 'Agencies', icon: 'Network', path: '/agencies' },
  { id: 'roles', label: 'Roles', icon: 'Bot', path: '/roles' },
  { id: 'skills', label: 'Skills', icon: 'Wand2', path: '/skills' },
  { id: 'commands', label: 'Commands', icon: 'Terminal', path: '/commands' },
  { id: 'settings', label: 'Settings', icon: 'Settings2', path: '/settings' },
]

const pluginRoutes: Record<string, string> = {
  github: '/github/prs',
  jira: '/jira',
}

const pluginItems = computed(() =>
  uiStore.getSlot('sidebar.primary').map((c) => ({
    ...c,
    path: pluginRoutes[c.id] ?? `/${c.id}`,
    unhealthy: c.id === 'github' && !githubHealthy.value,
  })),
)

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + '/')
}

function toggleFocus(projectPath: string) {
  if (projectsStore.focusedProject?.path === projectPath) {
    void projectsStore.setFocused(null)
  } else {
    void projectsStore.setFocused(projectPath)
  }
}
</script>

<template>
  <nav class="w-48 shrink-0 border-r border-border bg-card/30 flex flex-col py-3 gap-0.5">
    <button
      v-for="item in coreItems"
      :key="item.id"
      class="flex items-center gap-2 py-2 px-3 mx-1 rounded-md text-xs font-medium transition-colors"
      :class="
        isActive(item.path)
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      "
      @click="void router.push(item.path)"
    >
      <component :is="iconMap[item.icon]" class="size-4 shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </button>

    <div v-if="pluginItems.length" class="mx-2 my-1 border-t border-border/50" />

    <button
      v-for="item in pluginItems"
      :key="item.id"
      class="relative flex items-center gap-2 py-2 px-3 mx-1 rounded-md text-xs font-medium transition-colors"
      :class="
        isActive(item.path)
          ? 'bg-primary/10 text-primary'
          : item.unhealthy
            ? 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/50'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      "
      @click="void router.push(item.path)"
    >
      <div class="relative shrink-0">
        <component
          :is="item.icon ? iconMap[item.icon] : null"
          v-if="item.icon && iconMap[item.icon]"
          class="size-4"
        />
        <span
          v-if="item.unhealthy"
          class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500"
        />
      </div>
      <span class="truncate">{{ item.label }}</span>
    </button>

    <div class="mx-2 my-1 border-t border-border/50" />

    <button
      v-for="item in workspaceItems"
      :key="item.id"
      class="flex items-center gap-2 py-2 px-3 mx-1 rounded-md text-xs font-medium transition-colors"
      :class="
        isActive(item.path)
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      "
      @click="void router.push(item.path)"
    >
      <component :is="iconMap[item.icon]" class="size-4 shrink-0" />
      <span class="truncate">{{ item.label }}</span>
    </button>

    <!-- Projects section -->
    <div class="mt-auto mx-2 pt-2 border-t border-border/50">
      <div class="flex items-center justify-between px-1 pb-1">
        <span class="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
          Projects
        </span>
        <button
          class="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          title="Add project"
          @click="void projectsStore.pickAndAdd()"
        >
          <Plus class="size-3" />
        </button>
      </div>

      <div v-if="projectsStore.projects.length === 0" class="px-1 py-1 text-xs text-muted-foreground/60">
        No projects
      </div>

      <button
        v-for="project in projectsStore.projects"
        :key="project.path"
        class="w-full flex items-center gap-2 py-1.5 px-1 rounded text-xs transition-colors"
        :class="
          projectsStore.focusedProject?.path === project.path
            ? 'text-foreground bg-primary/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        "
        :title="project.path"
        @click="toggleFocus(project.path)"
        @contextmenu.prevent="openContextMenu($event, project)"
      >
        <FolderOpen class="size-3.5 shrink-0" />
        <span class="truncate">{{ project.name }}</span>
        <span
          v-if="projectsStore.focusedProject?.path === project.path"
          class="ml-auto size-1.5 rounded-full bg-primary shrink-0"
        />
      </button>
    </div>
  </nav>

  <Teleport to="body">
    <!-- Context menu backdrop -->
    <div
      v-if="ctxOpen"
      class="fixed inset-0 z-40"
      @click="closeContextMenu"
      @contextmenu.prevent="closeContextMenu"
    />
    <!-- Context menu -->
    <div
      v-if="ctxOpen && ctxProject"
      class="fixed z-50 min-w-[130px] rounded-md border border-border bg-popover shadow-md py-1"
      :style="{ left: ctxPos.x + 'px', top: ctxPos.y + 'px' }"
    >
      <button
        class="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
        @click="openRenameDialog(ctxProject)"
      >
        Rename
      </button>
      <button
        class="w-full text-left px-3 py-1.5 text-xs text-destructive hover:bg-muted transition-colors"
        @click="removeProject(ctxProject)"
      >
        Remove
      </button>
    </div>

    <!-- Rename dialog -->
    <div v-if="renameOpen" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40" @click="cancelRename" />
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
  </Teleport>
</template>
