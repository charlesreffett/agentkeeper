<script setup lang="ts">
import { computed, type ComputedRef } from 'vue'
import { usePerformanceQuery } from '@/composables/usePerformanceQuery'

const props = defineProps<{
  projectPath?: string | null
}>()

const projectPathRef = computed(() => props.projectPath ?? null) as ComputedRef<string | null>
const { data, isLoading } = usePerformanceQuery(projectPathRef)

const costPerWorkItem = computed(() => data.value?.costPerWorkItem ?? [])
</script>

<template>
  <div v-if="!isLoading && costPerWorkItem.length > 0" class="rounded-xl border bg-card p-4">
    <span class="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold block mb-3">Cost per Task</span>
    <div class="flex flex-col gap-1">
      <div
        v-for="item in costPerWorkItem"
        :key="item.workItemKey"
        class="flex items-center justify-between text-sm"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-mono text-xs text-muted-foreground shrink-0">{{ item.workItemKey }}</span>
          <span v-if="item.workItemTitle" class="text-foreground truncate">{{ item.workItemTitle }}</span>
        </div>
        <span class="tabular-nums font-medium shrink-0 ml-4">${{ item.totalCostUsd.toFixed(2) }}</span>
      </div>
    </div>
  </div>
</template>
