<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next'
import { RouterLink, type RouteLocationRaw } from 'vue-router'

defineProps<{
  title: string
  description?: string
  backTo?: RouteLocationRaw
}>()
</script>

<template>
  <div class="shrink-0 border-b border-border px-6 py-3 flex items-center justify-between gap-4">
    <div class="flex items-center min-w-0">
      <RouterLink
        v-if="backTo"
        :to="backTo"
        class="text-muted-foreground hover:text-foreground mr-1 shrink-0"
      >
        <ArrowLeft class="size-4" />
      </RouterLink>
      <div class="flex flex-col min-w-0">
        <h1 class="text-base font-semibold">{{ title }}</h1>
        <p v-if="description" class="text-sm text-muted-foreground mt-0.5">{{ description }}</p>
      </div>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
      <slot name="actions" />
    </div>
  </div>
</template>
