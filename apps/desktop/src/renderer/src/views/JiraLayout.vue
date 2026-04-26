<script setup lang="ts">
import { ref } from 'vue'
import { Settings } from 'lucide-vue-next'
import { usePluginHealth } from '@/composables/usePluginHealth'
import JiraSettingsModal from './JiraSettingsModal.vue'

const { isHealthy } = usePluginHealth('jira')
const settingsOpen = ref(false)
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      v-if="!isHealthy"
      class="shrink-0 flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400"
    >
      <span>⚠</span>
      <span>Jira CLI not found. Install <code class="font-mono">jira</code> and restart the app.</span>
    </div>
    <div class="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border">
      <span class="text-sm font-semibold">Jira</span>
      <button
        class="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
        title="Jira settings"
        @click="settingsOpen = true"
      >
        <Settings :size="14" />
      </button>
    </div>
    <div class="flex-1 min-h-0 overflow-hidden">
      <RouterView />
    </div>
  </div>

  <JiraSettingsModal
    :open="settingsOpen"
    @close="settingsOpen = false"
    @saved="() => {}"
  />
</template>
