<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { LayoutDashboard, Grid, GitPullRequest, Layers, FolderOpen, Plus } from 'lucide-vue-next'
import type { Component } from 'vue'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { usePluginHealth } from '@/composables/usePluginHealth'
import { useProjectsStore } from '@/stores/projects'

const router = useRouter()
const route = useRoute()
const uiStore = useUIContributionsStore()
const projectsStore = useProjectsStore()
const { isHealthy: githubHealthy } = usePluginHealth('github')

const iconMap: Record<string, Component> = {
  LayoutDashboard,
  Grid,
  GitPullRequest,
  Layers,
}

const coreItems = [
  { id: 'sessions', label: 'Sessions', icon: 'LayoutDashboard', path: '/project' },
  { id: 'monitor', label: 'Monitor', icon: 'Grid', path: '/monitor' },
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
</template>
