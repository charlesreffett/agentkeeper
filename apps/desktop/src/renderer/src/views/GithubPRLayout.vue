<script setup lang="ts">
import { onMounted, provide, ref, computed } from 'vue'
import { useRoute, RouterLink, RouterView } from 'vue-router'
import type { PRDetail, PRState } from '@shared/github-types'

const route = useRoute()
const prNumber = computed(() => Number(route.params.number))
const prRepo = computed(() => String(route.query.repo ?? ''))

const pr = ref<PRDetail | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const refreshing = ref(false)

// Incremented each time the user hits Refresh — child views watch this to re-fetch.
const refreshTick = ref(0)
provide('prRefreshTick', refreshTick)

onMounted(async () => {
  try {
    pr.value = await window.agentkeeper.github.getPR(prRepo.value, prNumber.value)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

async function refresh() {
  refreshing.value = true
  try {
    pr.value = await window.agentkeeper.github.getPR(prRepo.value, prNumber.value)
    error.value = null
    refreshTick.value++
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    refreshing.value = false
  }
}

const stateClass: Record<PRState, string> = {
  open: 'bg-green-500/20 text-green-400',
  closed: 'bg-red-500/20 text-red-400',
  merged: 'bg-purple-500/20 text-purple-400',
}

const tabs = computed(() => [
  { label: 'Conversations', path: `/github/pr/${prNumber.value}/conversations`, query: { repo: prRepo.value } },
  { label: 'Checks', path: `/github/pr/${prNumber.value}/checks`, query: { repo: prRepo.value } },
  { label: 'Reviews', path: `/github/pr/${prNumber.value}/reviews`, query: { repo: prRepo.value } },
])
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 border-b border-border">
      <div class="flex items-center gap-2 px-4 py-3">
        <RouterLink
          to="/github/prs"
          class="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← PRs
        </RouterLink>

        <template v-if="loading">
          <span class="text-sm text-muted-foreground">Loading…</span>
        </template>
        <template v-else-if="error">
          <span class="text-sm text-destructive">{{ error }}</span>
        </template>
        <template v-else-if="pr">
          <span class="text-muted-foreground">/</span>
          <span
            class="text-xs px-2 py-0.5 rounded-full"
            :class="stateClass[pr.state]"
          >{{ pr.state }}</span>
          <span class="text-sm font-medium truncate">
            {{ pr.title }}
            <span class="text-muted-foreground font-normal">#{{ pr.number }}</span>
          </span>
          <span v-if="pr.isDraft" class="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Draft</span>
        </template>
      </div>

      <nav class="flex items-center gap-1 px-4 pb-0">
        <RouterLink
          v-for="tab in tabs"
          :key="tab.label"
          :to="{ path: tab.path, query: tab.query }"
          class="text-sm px-3 py-2 border-b-2 transition-colors"
          :class="route.path === tab.path
            ? 'border-foreground text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'"
        >
          {{ tab.label }}
        </RouterLink>
        <button
          class="ml-auto self-center text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50 transition-colors"
          :disabled="refreshing"
          @click="refresh"
        >{{ refreshing ? 'Refreshing…' : '↻ Refresh' }}</button>
      </nav>
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <RouterView />
    </div>
  </div>
</template>
