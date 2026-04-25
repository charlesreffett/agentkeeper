import { createRouter, createWebHashHistory } from 'vue-router'
import Welcome from '@/views/Welcome.vue'
import ProjectHome from '@/views/ProjectHome.vue'
import MonitorView from '@/views/MonitorView.vue'
import GithubLayout from '@/views/GithubLayout.vue'
import GithubPRLayout from '@/views/GithubPRLayout.vue'
import GithubPRsView from '@/views/GithubPRsView.vue'
import GithubPRConversationsView from '@/views/GithubPRConversationsView.vue'
import GithubPRChecksView from '@/views/GithubPRChecksView.vue'
import GithubPRReviewsView from '@/views/GithubPRReviewsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Welcome },
    { path: '/project', component: ProjectHome },
    { path: '/monitor', component: MonitorView },
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

export default router
