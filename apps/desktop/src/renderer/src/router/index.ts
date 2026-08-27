import { createRouter, createWebHashHistory } from 'vue-router'
import { installPrefetchGuard } from './prefetch'
import MonitorView from '@/views/MonitorView.vue'
import GithubLayout from '@/views/GithubLayout.vue'
import GithubPRLayout from '@/views/GithubPRLayout.vue'
import GithubPRsView from '@/views/GithubPRsView.vue'
import GithubPRConversationsView from '@/views/GithubPRConversationsView.vue'
import GithubPRChecksView from '@/views/GithubPRChecksView.vue'
import GithubPRReviewsView from '@/views/GithubPRReviewsView.vue'
import JiraLayout from '@/views/JiraLayout.vue'
import JiraBoardView from '@/views/JiraBoardView.vue'
import JiraIssueView from '@/views/JiraIssueView.vue'
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
        { path: 'github', component: () => import('../views/settings/GitHubSettingsView.vue') },
        { path: 'jira', component: () => import('../views/settings/JiraSettingsView.vue') },
        { path: 'mcp', component: () => import('../views/settings/McpSettingsView.vue') },
        { path: 'updates', component: () => import('../views/settings/UpdatesSettingsView.vue') },
        { path: 'data', component: () => import('../views/settings/DataSettingsView.vue') },
      ],
    },
    {
      path: '/jira',
      component: JiraLayout,
      children: [
        { path: '', redirect: '/jira/board' },
        { path: 'board', component: JiraBoardView },
        { path: 'issue/:id', component: JiraIssueView },
      ],
    },
    {
      path: '/github',
      component: GithubLayout,
      children: [
        { path: 'prs', component: GithubPRsView },
        {
          path: 'pr/:number',
          component: GithubPRLayout,
          children: [
            { path: 'conversations', component: GithubPRConversationsView },
            { path: 'checks', component: GithubPRChecksView },
            { path: 'reviews', component: GithubPRReviewsView },
          ],
        },
      ],
    },
  ],
})

installPrefetchGuard(router)

router.beforeEach((to, from) => {
  if (shouldCaptureSettingsOrigin(to.path, from.path, from.matched.length > 0)) {
    captureSettingsOrigin(from.fullPath)
  }
})

export default router
