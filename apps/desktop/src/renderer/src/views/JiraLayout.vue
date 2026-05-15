<script setup lang="ts">
import { onMounted, onUnmounted, provide, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Settings } from 'lucide-vue-next'
import { usePluginHealth } from '@/composables/usePluginHealth'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const { isHealthy } = usePluginHealth('jira')

// Increment when Jira settings change so child views re-fetch configured boards.
// Sourced from the plugin event bus rather than a local modal, so changes made
// from the Settings page also propagate.
const jiraConfigVersion = ref(0)
provide('jiraConfigVersion', jiraConfigVersion)

let cleanup: (() => void) | null = null

onMounted(() => {
  cleanup = window.agentkeeper.plugins.onEvent((event, payload) => {
    const p = payload as { pluginId?: string } | null
    if (event === 'settings.changed' && p?.pluginId === 'jira') {
      jiraConfigVersion.value++
    }
  })
})

onUnmounted(() => {
  cleanup?.()
  cleanup = null
})
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
          @click="void router.push('/settings?tab=jira')"
        >
          <Settings :size="14" />
        </button>
      </template>
    </PageHeader>
    <div class="flex-1 min-h-0 overflow-hidden">
      <RouterView />
    </div>
  </div>
</template>
