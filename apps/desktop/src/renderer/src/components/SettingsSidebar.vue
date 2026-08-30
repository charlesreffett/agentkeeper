<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import type { Component } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft, Bot, Download, GitPullRequest, Layers, Palette, Plug,
  Puzzle, Radio, RotateCcw, Settings2,
} from '@/components/icons/app-icons'
import { leaveSettings, readSettingsOrigin, replaceSettingsRoute } from '@/lib/settingsNavigation'
import { settingsGroups, settingsSections } from '@/lib/settingsSections'
import { queryKeys } from '@/lib/queryKeys'
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from '@/components/ui/sidebar'

const router = useRouter()
const route = useRoute()
const { isMobile, setOpenMobile } = useSidebar()
const { data: plugins } = useQuery({
  queryKey: queryKeys.plugins.list(),
  queryFn: () => window.agentkeeper.plugins.list(),
  staleTime: 30_000,
})
const iconMap: Record<string, Component> = {
  Settings2, Bot, Palette, Puzzle, Radio, GitPullRequest, Layers, Plug, Download, RotateCcw,
}

const originLabel = computed(() => {
  const path = readSettingsOrigin()?.fullPath
  if (!path) return 'Back to Sessions'
  const segment = path.split(/[/?#]/).filter(Boolean)[0]
  return segment ? `Back to ${segment[0]!.toUpperCase()}${segment.slice(1)}` : 'Back'
})

const pluginSections = computed(() => (plugins.value ?? [])
  .filter(plugin => plugin.enabled)
  .flatMap(plugin => (plugin.manifest.contributes?.settings ?? []).map(page => ({
    path: `/settings/plugin/${encodeURIComponent(plugin.id)}/${page.route.replace(/^\/+/, '')}`,
    label: page.label,
    icon: page.icon ?? 'Puzzle',
    group: page.group,
  }))))

const allSections = computed(() => [...settingsSections, ...pluginSections.value])
const visibleGroups = computed(() => settingsGroups.filter(group => allSections.value.some(section => section.group === group)))

function closeMobile() {
  if (isMobile.value) setOpenMobile(false)
}

function goBack() {
  closeMobile()
  void leaveSettings(router)
}

function selectSection(path: string) {
  closeMobile()
  if (route.path !== path) void replaceSettingsRoute(router, path)
}
</script>

<template>
  <Sidebar collapsible="icon" class="!h-full" aria-label="Settings navigation">
    <SidebarHeader class="border-b border-sidebar-border p-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton :tooltip="originLabel" aria-label="Back from Settings" @click="goBack">
            <span class="flex w-8 shrink-0 items-center justify-center"><ArrowLeft class="size-5" /></span>
            <span>{{ originLabel }}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup v-for="group in visibleGroups" :key="group">
        <SidebarGroupLabel>{{ group }}</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem
            v-for="item in allSections.filter(section => section.group === group)"
            :key="item.path"
          >
            <SidebarMenuButton
              size="sm"
              :is-active="route.path === item.path"
              :tooltip="item.label"
              :aria-current="route.path === item.path ? 'page' : undefined"
              @click="selectSection(item.path)"
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
    <SidebarRail />
  </Sidebar>
</template>
