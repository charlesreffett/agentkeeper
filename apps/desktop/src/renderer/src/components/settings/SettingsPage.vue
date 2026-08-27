<script setup lang="ts">
import PageHeader from '@/components/PageHeader.vue'

defineProps<{ title: string; description?: string; contentClass?: string }>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden">
    <PageHeader :title="title" :description="description">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div :class="contentClass ?? 'mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6'"><slot /></div>
    </main>
    <slot name="footer" />
  </div>
</template>
