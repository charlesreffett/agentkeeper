<script setup lang="ts">
import { ref, watch } from 'vue'
import { useSettingsQuery } from '@/composables/useSettingsQuery'

const { githubConfig: storedGithubConfig } = useSettingsQuery()

const githubRepos = ref<string[]>([])

watch(storedGithubConfig, (cfg) => {
  if (cfg != null) githubRepos.value = cfg.repos ?? []
}, { immediate: true })
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-sm font-semibold mb-1">Repositories</h2>
      <p class="text-xs text-muted-foreground">
        Repos are auto-detected from your registered projects. Open a project with a GitHub remote to add it here.
      </p>
    </div>

    <div v-if="githubRepos.length > 0" class="flex flex-wrap gap-2">
      <span
        v-for="repo in githubRepos"
        :key="repo"
        class="inline-flex items-center text-xs px-2 py-1 rounded-full bg-muted text-foreground"
      >
        <span class="font-mono">{{ repo }}</span>
      </span>
    </div>

    <p v-else class="text-xs text-muted-foreground italic">No repos detected yet.</p>
  </div>
</template>
