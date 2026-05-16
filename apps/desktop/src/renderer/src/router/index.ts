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
import SettingsView from '@/views/SettingsView.vue'
import SessionsView from '@/views/SessionsView.vue'
import SessionDetailView from '@/views/SessionDetailView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/sessions' },
    { path: '/sessions', component: SessionsView },
    { path: '/sessions/:id', component: SessionDetailView },
    { path: '/monitor', component: MonitorView },
    { path: '/planner', component: PlannerListView },
    { path: '/planner/:filename', component: PlannerDetailView },
    { path: '/agencies', component: AgenciesView },
    { path: '/roles', component: RolesView },
    { path: '/skills', component: SkillsView },
    { path: '/commands', component: CommandsView },
    { path: '/settings', component: SettingsView },
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

export default router
