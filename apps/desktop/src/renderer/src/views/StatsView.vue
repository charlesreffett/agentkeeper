<script setup lang="ts">
import { computed } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import ScopeBar from '@/components/ScopeBar.vue'
import StatsCards from '@/components/StatsCards.vue'
import PerformanceSection from '@/components/PerformanceSection.vue'
import { usePageScope } from '@/composables/usePageScope'

const { scope, options, label, color, setScope, pickAndAdd, isAll, currentProject } =
  usePageScope('stats')

const projectPath = computed(() => (isAll.value ? null : currentProject.value?.path ?? null))

const description = computed(() => (isAll.value ? 'All projects' : label.value))
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <PageHeader title="Stats" :description="description">
      <template #actions>
        <ScopeBar
          :scope="scope"
          :options="options"
          :label="label"
          :color="color"
          @select="setScope"
          @pick-and-add="pickAndAdd"
        />
      </template>
    </PageHeader>

    <div class="flex-1 overflow-auto p-6">
      <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <StatsCards :project-path="projectPath" />

        <PerformanceSection :project-path="projectPath" />
      </div>
    </div>
  </div>
</template>
