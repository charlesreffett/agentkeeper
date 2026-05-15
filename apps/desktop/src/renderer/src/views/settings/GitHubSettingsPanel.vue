<script setup lang="ts">
import { ref, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { useSettingsQuery } from '@/composables/useSettingsQuery'
import { queryKeys } from '@/lib/queryKeys'

const OWNER_REPO_RE = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/

const queryClient = useQueryClient()
const { githubConfig: storedGithubConfig } = useSettingsQuery()

const githubRepos = ref<string[]>([])
const newRepoInput = ref('')
const newRepoError = ref<string | null>(null)

watch(storedGithubConfig, (cfg) => {
  if (cfg != null) githubRepos.value = cfg.repos ?? []
}, { immediate: true })

async function addRepo() {
  const val = newRepoInput.value.trim()
  newRepoError.value = null
  if (!val) return
  if (!OWNER_REPO_RE.test(val)) {
    newRepoError.value = 'Must be owner/repo format, e.g. anthropics/claude-code.'
    return
  }
  if (githubRepos.value.includes(val)) {
    newRepoError.value = 'Repo already added.'
    return
  }
  githubRepos.value = [...githubRepos.value, val]
  await window.agentkeeper.github.setConfig({ repos: githubRepos.value })
  queryClient.setQueryData(queryKeys.settings.github(), { repos: githubRepos.value })
  newRepoInput.value = ''
}

async function removeRepo(repo: string) {
  githubRepos.value = githubRepos.value.filter((r) => r !== repo)
  await window.agentkeeper.github.setConfig({ repos: githubRepos.value })
  queryClient.setQueryData(queryKeys.settings.github(), { repos: githubRepos.value })
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-sm font-semibold mb-1">Repositories</h2>
      <p class="text-xs text-muted-foreground">
        Repos scoped for GitHub PR and issue operations. Changes save immediately.
      </p>
    </div>

    <div v-if="githubRepos.length > 0" class="flex flex-wrap gap-2">
      <span
        v-for="repo in githubRepos"
        :key="repo"
        class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-foreground"
      >
        <span class="font-mono">{{ repo }}</span>
        <button
          class="ml-1 text-muted-foreground hover:text-destructive transition-colors leading-none"
          @click="void removeRepo(repo)"
        >×</button>
      </span>
    </div>

    <div class="space-y-1">
      <div class="flex gap-2">
        <input
          v-model="newRepoInput"
          type="text"
          placeholder="owner/repo"
          class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:border-ring font-mono"
          @blur="void addRepo()"
          @keydown.enter.prevent="void addRepo()"
          @input="newRepoError = null"
        />
      </div>
      <p v-if="newRepoError" class="text-xs text-amber-600 dark:text-amber-400">{{ newRepoError }}</p>
    </div>
  </div>
</template>
