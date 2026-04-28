<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { useSessionStore } from '@/stores/sessions'
import { useProjectStore } from '@/stores/project'
import { useProjectsStore } from '@/stores/projects'
import type { RecentProject } from '@shared/ipc-contract'

const router = useRouter()
const sessionStore = useSessionStore()
const projectStore = useProjectStore()
const projectsStore = useProjectsStore()
const activeCount = computed(() => sessionStore.liveList.length)

const recent = ref<RecentProject[]>([])
const loading = ref(true)

async function refresh() {
  recent.value = await window.agentkeeper.project.recent.list()
  loading.value = false
}

async function pickProject() {
  const project = await window.agentkeeper.project.pick()
  if (project) {
    await refresh()
    projectStore.setProject(project)
    router.push('/project')
  }
}

function openRecent(project: RecentProject) {
  projectStore.setProject(project)
  router.push('/project')
}

async function removeRecent(path: string, event: Event) {
  event.stopPropagation()
  await projectsStore.remove(path)
  await refresh()
}

onMounted(refresh)
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center p-8">
    <div class="w-full max-w-xl space-y-8">
      <div class="text-center space-y-2">
        <h1 class="text-4xl font-semibold tracking-tight">AgentKeeper</h1>
        <p class="text-muted-foreground">Open a project to begin</p>
      </div>

      <div class="flex justify-center gap-2">
        <Button size="lg" @click="pickProject">Open Project…</Button>
        <Button
          v-if="activeCount > 0"
          size="lg"
          variant="outline"
          @click="router.push('/monitor')"
        >
          Monitor ({{ activeCount }} live)
        </Button>
      </div>

      <div v-if="!loading && recent.length" class="space-y-2">
        <h2
          class="text-xs font-medium text-muted-foreground uppercase tracking-wide"
        >
          Recent
        </h2>
        <ul class="space-y-1">
          <li
            v-for="p in recent"
            :key="p.path"
            class="group flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 hover:border-ring transition cursor-pointer"
            @click="openRecent(p)"
          >
            <div class="min-w-0 flex-1">
              <div class="font-medium truncate">{{ p.name }}</div>
              <div class="text-xs text-muted-foreground truncate">
                {{ p.path }}
              </div>
            </div>
            <button
              class="ml-4 opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-foreground transition"
              :aria-label="`Remove ${p.name} from recent`"
              @click="(e) => removeRecent(p.path, e)"
            >
              Remove
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
