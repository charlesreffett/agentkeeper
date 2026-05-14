<script setup lang="ts">
import { provide, ref } from 'vue'
import { Settings } from 'lucide-vue-next'
import { usePluginHealth } from '@/composables/usePluginHealth'
import JiraSettingsModal from './JiraSettingsModal.vue'
import PageHeader from '@/components/PageHeader.vue'

const { isHealthy } = usePluginHealth('jira')
const settingsOpen = ref(false)

// Increment when settings are saved so child views can react
const jiraConfigVersion = ref(0)
provide('jiraConfigVersion', jiraConfigVersion)

function onSettingsSaved() {
  jiraConfigVersion.value++
}
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
    <PageHeader title="Jira">
      <template #actions>
        <button
          class="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
          title="Jira settings"
          @click="settingsOpen = true"
        >
          <Settings :size="14" />
        </button>
      </template>
    </PageHeader>
    <div class="flex-1 min-h-0 overflow-hidden">
      <RouterView />
    </div>
  </div>

  <JiraSettingsModal
    :open="settingsOpen"
    @close="settingsOpen = false"
    @saved="onSettingsSaved"
  />
</template>
