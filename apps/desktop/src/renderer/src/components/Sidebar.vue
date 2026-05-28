<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { queryKeys } from '@/lib/queryKeys'
import {
  LayoutDashboard,
  Grid,
  Activity,
  GitPullRequest,
  Layers,
  Network,
  Bot,
  Wand2,
  Sparkles,
  Terminal,
  Settings2,
  Map,
  Puzzle,
  Plug,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import IconSessions from '@/components/icons/IconSessions.vue'
import { useUIContributionsStore } from '@/stores/uiContributions'
import { usePluginHealth } from '@/composables/usePluginHealth'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from '@/components/ui/sidebar'

const router = useRouter()
const route = useRoute()
const uiStore = useUIContributionsStore()
const { isHealthy: githubHealthy } = usePluginHealth('github')

const { data: pluginList } = useQuery({
  queryKey: queryKeys.plugins.list(),
  queryFn: () => window.agentkeeper.plugins.list(),
  staleTime: 30_000,
})

const BUNDLED_SIDEBAR: Record<string, { label: string; icon: string; path: string; order: number }> = {
  'agentkeeper-github': { label: 'GitHub', icon: 'GitPullRequest', path: '/github/prs', order: 20 },
  'agentkeeper-jira':   { label: 'Jira',   icon: 'Layers',        path: '/jira',       order: 10 },
}

const iconMap: Record<string, Component> = {
  IconSessions,
  LayoutDashboard,
  Grid,
  Activity,
  GitPullRequest,
  Layers,
  Network,
  Bot,
  Wand2,
  Sparkles,
  Terminal,
  Settings2,
  Map,
  Puzzle,
  Plug,
}

const coreItems = [
  { id: 'sessions', label: 'Sessions', icon: 'IconSessions', path: '/sessions' },
  { id: 'monitor', label: 'Monitor', icon: 'Activity', path: '/monitor' },
  { id: 'planner', label: 'Planner', icon: 'Sparkles', path: '/planner' },
]

const workspaceItems = [
  { id: 'agencies', label: 'Agencies', icon: 'Network', path: '/agencies' },
  { id: 'roles', label: 'Roles', icon: 'Bot', path: '/roles' },
  { id: 'skills', label: 'Skills', icon: 'Wand2', path: '/skills' },
  { id: 'commands', label: 'Commands', icon: 'Terminal', path: '/commands' },
]

const pluginRoutes: Record<string, string> = {
  github: '/github/prs',
  jira: '/jira',
}

const pluginItems = computed(() => {
  // Bundled plugins: derive from DB enabled state so toggle hides/shows the item
  const fromDb = (pluginList.value ?? [])
    .filter(p => p.enabled && BUNDLED_SIDEBAR[p.id])
    .map(p => {
      const cfg = BUNDLED_SIDEBAR[p.id]!
      const shortId = p.id.replace('agentkeeper-', '')
      return { ...cfg, id: shortId, unhealthy: shortId === 'github' && !githubHealthy.value }
    })

  // Dynamic contributions from actually-running plugin hosts (future / test plugins)
  const fromContributions = uiStore.getSlot('sidebar.primary')
    .filter(c => !fromDb.some(d => d.id === c.id))
    .map(c => ({
      ...c,
      path: pluginRoutes[c.id] ?? `/${c.id}`,
      unhealthy: c.id === 'github' && !githubHealthy.value,
    }))

  return [...fromDb, ...fromContributions].sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
})

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + '/')
}
</script>

<template>
  <Sidebar collapsible="icon">
    <!-- macOS traffic-light zone — drag region, no content -->
    <SidebarHeader
      class="h-11 shrink-0 p-0"
      style="-webkit-app-region: drag"
    />

    <SidebarContent>
      <!-- Core navigation -->
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in coreItems" :key="item.id">
            <SidebarMenuButton
              size="sm"
              :is-active="isActive(item.path)"
              :tooltip="item.label"
              @click="void router.push(item.path)"
            >
              <component :is="iconMap[item.icon]" />
              <span>{{ item.label }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>

      <!-- Plugin navigation -->
      <template v-if="pluginItems.length">
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in pluginItems" :key="item.id">
              <SidebarMenuButton
                size="sm"
                :is-active="isActive(item.path)"
                :tooltip="item.label"
                :class="item.unhealthy ? 'opacity-50' : ''"
                @click="void router.push(item.path)"
              >
                <!-- Relative wrapper preserves the unhealthy amber dot in both expand/collapse -->
                <div class="relative size-4 shrink-0">
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
                <span>{{ item.label }}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </template>

      <!-- Workspace navigation -->
      <SidebarSeparator />
      <SidebarGroup>
        <SidebarMenu>
          <SidebarMenuItem v-for="item in workspaceItems" :key="item.id">
            <SidebarMenuButton
              size="sm"
              :is-active="isActive(item.path)"
              :tooltip="item.label"
              @click="void router.push(item.path)"
            >
              <component :is="iconMap[item.icon]" />
              <span>{{ item.label }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarRail />
  </Sidebar>
</template>
