<script setup lang="ts">
import { usePluginHealth } from '@/composables/usePluginHealth'

const { isHealthy } = usePluginHealth('github')
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      v-if="!isHealthy"
      class="shrink-0 flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400"
    >
      <span>⚠</span>
      <span>
        The gh CLI was not found. Install it from
        <code class="font-mono">cli.github.com</code> and restart the app.
      </span>
    </div>
    <div class="flex-1 min-h-0 overflow-auto">
      <RouterView />
    </div>
  </div>
</template>
