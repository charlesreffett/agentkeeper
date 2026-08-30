import { createRouter, createWebHashHistory } from 'vue-router'
import { installPrefetchGuard } from './prefetch'
import MonitorView from '@/views/MonitorView.vue'
import PluginView from '@/views/plugins/PluginView.vue'
import PlannerListView from '@/views/PlannerListView.vue'
import PlannerDetailView from '@/views/PlannerDetailView.vue'
import AgenciesView from '@/views/AgenciesView.vue'
import RolesView from '@/views/RolesView.vue'
import SkillsView from '@/views/SkillsView.vue'
import CommandsView from '@/views/CommandsView.vue'
import SettingsLayout from '@/views/settings/SettingsLayout.vue'
import GeneralSettingsView from '@/views/settings/GeneralSettingsView.vue'
import ModelsSettingsView from '@/views/settings/ModelsSettingsView.vue'
import AppearanceSettingsView from '@/views/settings/AppearanceSettingsView.vue'
import SessionsWorkspace from '@/views/SessionsWorkspace.vue'
import StatsView from '@/views/StatsView.vue'
import { captureSettingsOrigin } from '@/lib/settingsNavigation'
import { shouldCaptureSettingsOrigin } from '@/lib/settingsShell'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/sessions' },
    { path: '/sessions', component: SessionsWorkspace },
    { path: '/sessions/:id', component: SessionsWorkspace },
    { path: '/monitor', component: MonitorView },
    { path: '/stats', component: StatsView },
    { path: '/planner', component: PlannerListView },
    { path: '/planner/:id', component: PlannerDetailView },
    { path: '/agencies', component: AgenciesView },
    { path: '/roles', component: RolesView },
    { path: '/skills', component: SkillsView },
    { path: '/commands', component: CommandsView },
    {
      path: '/settings',
      component: SettingsLayout,
      children: [
        { path: '', redirect: '/settings/general' },
        { path: 'general', component: GeneralSettingsView },
        { path: 'models', component: ModelsSettingsView },
        { path: 'appearance', component: AppearanceSettingsView },
        { path: 'plugins', component: () => import('../views/settings/PluginsSettingsView.vue') },
        { path: 'remote', component: () => import('../views/settings/RemoteSettingsView.vue') },
        { path: 'mcp', component: () => import('../views/settings/McpSettingsView.vue') },
        { path: 'updates', component: () => import('../views/settings/UpdatesSettingsView.vue') },
        { path: 'data', component: () => import('../views/settings/DataSettingsView.vue') },
        { path: 'plugin/:pluginId/:pathMatch(.*)*', component: PluginView },
      ],
    },
    { path: '/plugin/:pluginId/:pathMatch(.*)*', component: PluginView },
  ],
})

installPrefetchGuard(router)

router.beforeEach((to, from) => {
  if (shouldCaptureSettingsOrigin(to.path, from.path, from.matched.length > 0)) {
    captureSettingsOrigin(from.fullPath)
  }
})

export default router
