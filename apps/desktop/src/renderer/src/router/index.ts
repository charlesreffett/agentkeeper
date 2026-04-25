import { createRouter, createWebHashHistory } from 'vue-router'
import Welcome from '@/views/Welcome.vue'
import ProjectHome from '@/views/ProjectHome.vue'
import MonitorView from '@/views/MonitorView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: Welcome },
    { path: '/project', component: ProjectHome },
    { path: '/monitor', component: MonitorView },
  ],
})

export default router
