<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  LayoutDashboard,
  Grid,
  Activity,
  GitPullRequest,
  Layers,
  FolderOpen,
  Network,
  Bot,
  Wand2,
  Sparkles,
  Terminal,
  Settings2,
  Map,
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

const iconMap: Record<string, Component> = {
  IconSessions,
  LayoutDashboard,
  Grid,
  Activity,
  GitPullRequest,
  Layers,
  FolderOpen,
  Network,
  Bot,
  Wand2,
  Sparkles,
  Terminal,
  Settings2,
  Map,
}

const coreItems = [
  { id: 'sessions', label: 'Sessions', icon: 'IconSessions', path: '/sessions' },
  { id: 'monitor', label: 'Monitor', icon: 'Activity', path: '/monitor' },
  { id: 'planner', label: 'Planner', icon: 'Sparkles', path: '/planner' },
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
