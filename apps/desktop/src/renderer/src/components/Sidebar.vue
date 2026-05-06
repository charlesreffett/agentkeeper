<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { LayoutDashboard, Grid, GitPullRequest, Layers, FolderOpen, Network, Bot, Wand2, Terminal, Settings2, Map } from 'lucide-vue-next'
import type { Component } from 'vue'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { usePluginHealth } from '@/composables/usePluginHealth'

const router = useRouter()
const route = useRoute()
const uiStore = useUIContributionsStore()
const { isHealthy: githubHealthy } = usePluginHealth('github')

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
  </nav>
</template>
