<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { PRSummary, PRState, CheckState, ReviewDecision } from '@shared/github-types'
import { usePageScope } from '@/composables/usePageScope'
import ScopeBar from '@/components/ScopeBar.vue'

const router = useRouter()
const { scope, setScope, options, pickAndAdd, label, color, currentProject } =
  usePageScope('github', { defaultScope: 'all' })

const allPRs = ref<PRSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const stateFilter = ref<PRState | 'all'>('open')
const search = ref('')
const repos = ref<string[]>([])

async function load() {
  loading.value = true
  error.value = null
  try {
    const filters: Record<string, string> = {}
    if (stateFilter.value !== 'all') filters.state = stateFilter.value
    const scopedRepo = currentProject.value?.repo
    if (scopedRepo) filters.repo = scopedRepo
    allPRs.value = await window.agentkeeper.github.listPRs(filters)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function autoDetectRepos(projectPath: string) {
  try {
    const sources = await window.agentkeeper.remotes.detect(projectPath)
    const ghRepos = sources.filter((s) => s.type === 'github').map((s) => s.repo)
    if (ghRepos.length > 0) {
      await window.agentkeeper.github.setConfig({ repos: ghRepos })
      repos.value = ghRepos
    }
  } catch { /* silent */ }
}

// Re-load when the context scope changes: a scoped project filters PRs by its
// repo, All spans every configured repo.
watch(
  () => scope.value,
  async () => {
    const cfg = await window.agentkeeper.github.getConfig()
    repos.value = cfg.repos ?? []
    if (repos.value.length === 0 && currentProject.value?.path) {
      await autoDetectRepos(currentProject.value.path)
    }
    void load()
  },
  { immediate: true },
)

const filteredPRs = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return allPRs.value
  return allPRs.value.filter((pr) => pr.title.toLowerCase().includes(q))
})

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

const stateClass: Record<PRState, string> = {
  open: 'bg-green-500/20 text-green-400',
  closed: 'bg-red-500/20 text-red-400',
  merged: 'bg-purple-500/20 text-purple-400',
}

function checksIcon(state: CheckState | null): { symbol: string; cls: string } | null {
  if (!state) return null
  switch (state) {
    case 'pass':    return { symbol: '✓', cls: 'text-green-400' }
    case 'fail':    return { symbol: '✗', cls: 'text-red-400' }
    case 'pending': return { symbol: '○', cls: 'text-amber-400' }
    default:        return { symbol: '−', cls: 'text-muted-foreground' }
  }
}

const reviewClass: Record<NonNullable<ReviewDecision>, string> = {
  APPROVED: 'bg-green-500/20 text-green-400',
  CHANGES_REQUESTED: 'bg-red-500/20 text-red-400',
  REVIEW_REQUIRED: 'bg-amber-500/20 text-amber-400',
  COMMENTED: 'bg-blue-500/20 text-blue-400',
}

const reviewLabel: Record<NonNullable<ReviewDecision>, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes',
  REVIEW_REQUIRED: 'Review needed',
  COMMENTED: 'Commented',
}

function openSettingsModal() {
  // Emit to parent via a custom event on the window so the app shell can open settings
  window.dispatchEvent(new CustomEvent('agentkeeper:open-settings'))
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
      <ScopeBar
        :scope="scope"
        :options="options"
        :label="label"
        :color="color"
        @select="setScope"
        @pick-and-add="pickAndAdd"
      />
      <select
        v-model="stateFilter"
        class="text-sm bg-background border border-input rounded px-2 py-1 text-foreground"
        @change="load"
      >
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="merged">Merged</option>
        <option value="all">All</option>
      </select>
      <input
        v-model="search"
        type="text"
        placeholder="Filter by title…"
        class="flex-1 text-sm bg-background border border-input rounded px-3 py-1 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="animate-pulse text-sm text-muted-foreground">Loading pull requests…</div>
    </div>

    <div v-else-if="error" class="text-destructive text-sm p-4">{{ error }}</div>

    <div
      v-else-if="repos.length === 0"
      class="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm"
    >
      <span>No GitHub repos detected.</span>
      <button class="text-xs underline hover:text-foreground transition-colors" @click="openSettingsModal">
        Configure in Settings
      </button>
    </div>

    <div
      v-else-if="filteredPRs.length === 0"
      class="flex-1 flex items-center justify-center text-muted-foreground text-sm"
    >
      No pull requests found.
    </div>

    <div v-else class="flex-1 min-h-0 overflow-auto">
      <table class="w-full text-sm">
        <thead class="sticky top-0 bg-background border-b border-border">
          <tr class="text-left text-xs text-muted-foreground">
            <th class="px-4 py-2 font-medium w-14">#</th>
            <th class="px-4 py-2 font-medium">Title</th>
            <th class="px-4 py-2 font-medium w-24">Author</th>
            <th class="px-4 py-2 font-medium w-12 text-center">CI</th>
            <th class="px-4 py-2 font-medium w-32">Review</th>
            <th class="px-4 py-2 font-medium w-20 text-right">Updated</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="pr in filteredPRs"
            :key="`${pr.repo}/${pr.number}`"
            class="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
            @click="router.push({ path: `/github/pr/${pr.number}/conversations`, query: { repo: pr.repo } })"
          >
            <td class="px-4 py-2.5 text-muted-foreground font-mono">{{ pr.number }}</td>
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2 min-w-0">
                <span
                  class="shrink-0 text-xs px-1.5 py-0.5 rounded-full"
                  :class="stateClass[pr.state]"
                >{{ pr.state }}</span>
                <span v-if="pr.isDraft" class="shrink-0 text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">Draft</span>
                <span class="truncate">{{ pr.title }}</span>
              </div>
              <div class="flex gap-1 mt-1 flex-wrap items-center">
                <span v-if="repos.length > 1" class="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">{{ pr.repo }}</span>
                <span
                  v-for="label in pr.labels"
                  :key="label"
                  class="text-xs px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground"
                >{{ label }}</span>
              </div>
            </td>
            <td class="px-4 py-2.5 text-muted-foreground truncate">{{ pr.author }}</td>
            <td class="px-4 py-2.5 text-center">
              <span
                v-if="checksIcon(pr.checksState)"
                class="font-mono text-base"
                :class="checksIcon(pr.checksState)!.cls"
              >{{ checksIcon(pr.checksState)!.symbol }}</span>
            </td>
            <td class="px-4 py-2.5">
              <span
                v-if="pr.reviewDecision"
                class="text-xs px-2 py-0.5 rounded-full"
                :class="reviewClass[pr.reviewDecision]"
              >{{ reviewLabel[pr.reviewDecision] }}</span>
            </td>
            <td class="px-4 py-2.5 text-right text-muted-foreground text-xs">{{ relativeTime(pr.updatedAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
