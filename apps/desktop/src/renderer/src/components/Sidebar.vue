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
  ChartColumnBig,
} from '@/components/icons/app-icons'
import type { Component } from 'vue'
import IconSessions from '@/components/icons/IconSessions.vue'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { openSettings } from '@/lib/settingsNavigation'

const router = useRouter()
const route = useRoute()
const { isMobile, setOpenMobile } = useSidebar()

const { data: pluginList } = useQuery({
  queryKey: queryKeys.plugins.list(),
  queryFn: () => window.agentkeeper.plugins.list(),
  staleTime: 30_000,
})

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
  ChartColumnBig,
}

const coreItems = [
  { id: 'sessions', label: 'Sessions', icon: 'IconSessions', path: '/sessions' },
  { id: 'monitor', label: 'Monitor', icon: 'Activity', path: '/monitor' },
  { id: 'stats', label: 'Stats', icon: 'ChartColumnBig', path: '/stats' },
  { id: 'planner', label: 'Planner', icon: 'Sparkles', path: '/planner' },
]

const workspaceItems = [
  { id: 'agencies', label: 'Agencies', icon: 'Network', path: '/agencies' },
  { id: 'roles', label: 'Roles', icon: 'Bot', path: '/roles' },
  { id: 'skills', label: 'Skills', icon: 'Wand2', path: '/skills' },
  { id: 'commands', label: 'Commands', icon: 'Terminal', path: '/commands' },
]

const pluginItems = computed(() => {
  const fromManifests = (pluginList.value ?? [])
    .filter((plugin) => plugin.enabled)
    .flatMap((plugin) => (plugin.manifest.contributes?.navigation ?? []).map((item) => ({
      ...item,
      id: `${plugin.id}:${item.id}`,
      path: `/plugin/${encodeURIComponent(plugin.id)}/${item.route.replace(/^\/+/, '')}`,
      unhealthy: plugin.status === 'unhealthy',
    })))

  return fromManifests.sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
})

function isActive(path: string): boolean {
  return route.path === path || route.path.startsWith(path + '/')
}

function openAppSettings() {
  if (isMobile.value) setOpenMobile(false)
  void openSettings(router, route)
}
</script>

<template>
  <Sidebar collapsible="icon" class="!h-full">
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
              <span class="flex w-8 shrink-0 items-center justify-center">
                <component :is="iconMap[item.icon]" class="size-5" />
              </span>
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
                <!-- Fixed-width cell keeps the icon centered in both expand/collapse -->
                <span class="flex w-8 shrink-0 items-center justify-center">
                  <span class="relative size-5">
                    <component
                      :is="item.icon ? iconMap[item.icon] : null"
                      v-if="item.icon && iconMap[item.icon]"
                      class="size-5"
                    />
                    <span
                      v-if="item.unhealthy"
                      class="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-amber-500"
                    />
                  </span>
                </span>
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
              <span class="flex w-8 shrink-0 items-center justify-center">
                <component :is="iconMap[item.icon]" class="size-5" />
              </span>
              <span>{{ item.label }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter class="border-t border-sidebar-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            tooltip="Settings"
            aria-label="Settings"
            @click="openAppSettings"
          >
            <span class="flex w-8 shrink-0 items-center justify-center">
              <Settings2 class="size-5" />
            </span>
            <span>Settings</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
