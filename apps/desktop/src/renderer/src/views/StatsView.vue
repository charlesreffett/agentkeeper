<script setup lang="ts">
import { computed } from 'vue'
import ScopeBar from '@/components/ScopeBar.vue'
import StatsCards from '@/components/StatsCards.vue'
import PerformanceSection from '@/components/PerformanceSection.vue'
import { usePageScope } from '@/composables/usePageScope'

const { scope, options, label, color, setScope, pickAndAdd, isAll, currentProject } =
  usePageScope('stats')

const projectPath = computed(() => (isAll.value ? null : currentProject.value?.path ?? null))
</script>

<template>
  <div class="h-full flex overflow-hidden">
    <aside class="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
      <div class="p-3 border-b border-border shrink-0">
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
      </div>
    </aside>

    <div class="flex-1 overflow-auto p-6">
      <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <StatsCards :project-path="projectPath" />

        <PerformanceSection :project-path="projectPath" />
      </div>
    </div>
  </div>
</template>
