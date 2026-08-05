<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Layers } from 'lucide-vue-next'
import PageHeader from '@/components/PageHeader.vue'
import StatsCards from '@/components/StatsCards.vue'
import PerformanceSection from '@/components/PerformanceSection.vue'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { projectColor } from '@/lib/projectColor'
import { cn } from '@/lib/utils'

const { projects, focusedProject } = useProjectsQuery()

const scopePath = ref<string | null>(null)
let userSet = false

watch(
  () => focusedProject.value?.path ?? null,
  (path) => {
    if (!userSet) scopePath.value = path
  },
  { immediate: true },
)

function selectScope(path: string | null) {
  userSet = true
  scopePath.value = path
}

const activeProjects = computed(() =>
  projects.value.map((p) => ({ path: p.path, name: p.name.split('/').pop() ?? p.name })),
)

const description = computed(() => {
  if (scopePath.value) {
    const found = projects.value.find((p) => p.path === scopePath.value)
    return found ? `${found.name}` : scopePath.value.split('/').pop()
  }
  return 'All projects'
})

function selectedPillStyle(name: string): Record<string, string> {
  const hue = parseInt(projectColor(name).match(/hsl\((\d+)/)?.[1] ?? '0')
  return {
    backgroundColor: `hsl(${hue}, 55%, 93%)`,
    borderColor: `hsl(${hue}, 50%, 72%)`,
    color: `hsl(${hue}, 65%, 38%)`,
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Stats" :description="description" />

    <div class="flex-1 overflow-auto p-6">
      <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <!-- Project scope -->
        <div v-if="activeProjects.length > 0" class="flex items-center gap-2 flex-wrap">
          <button
            :class="
              cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border',
                scopePath === null
                  ? 'bg-primary/15 text-primary border-primary/50'
                  : 'text-muted-foreground hover:text-foreground border-border hover:border-foreground/30',
              )
            "
            @click="selectScope(null)"
          >
            <Layers class="size-3 shrink-0" />
            All projects
          </button>

          <button
            v-for="proj in activeProjects"
            :key="proj.path"
            :class="
              cn(
                'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all border',
                scopePath === proj.path
                  ? ''
                  : 'text-muted-foreground hover:text-foreground border-border hover:border-foreground/30',
              )
            "
            :style="scopePath === proj.path ? selectedPillStyle(proj.name) : {}"
            @click="selectScope(proj.path)"
          >
            <span
              class="size-2 rounded-full shrink-0"
              :style="{ backgroundColor: projectColor(proj.name) }"
            />
            {{ proj.name }}
          </button>
        </div>

        <StatsCards :project-path="scopePath" />

        <PerformanceSection :project-path="scopePath" />
      </div>
    </div>
  </div>
</template>
