<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import type { RecentProject } from '@shared/ipc-contract'

const emit = defineEmits<{ open: [project: RecentProject] }>()

const recent = ref<RecentProject[]>([])
const loading = ref(true)

async function refresh() {
  recent.value = await window.orchestral.project.recent.list()
  loading.value = false
}

async function pickProject() {
  const project = await window.orchestral.project.pick()
  if (project) {
    await refresh()
    emit('open', project)
  }
}

function openRecent(project: RecentProject) {
  emit('open', project)
}

async function removeRecent(path: string, event: Event) {
  event.stopPropagation()
  await window.orchestral.project.recent.remove(path)
  await refresh()
}

onMounted(refresh)
</script>

<template>
  <div class="h-full flex flex-col items-center justify-center p-8">
    <div class="w-full max-w-xl space-y-8">
      <div class="text-center space-y-2">
        <h1 class="text-4xl font-semibold tracking-tight">Orchestral AI</h1>
        <p class="text-muted-foreground">Open a project to begin</p>
      </div>

      <div class="flex justify-center">
        <Button size="lg" @click="pickProject">Open Project…</Button>
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
