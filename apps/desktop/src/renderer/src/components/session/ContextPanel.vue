<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, FileCode2, GitBranch, Layers, Tag } from 'lucide-vue-next'
import TokenBreakdownPopover from './TokenBreakdownPopover.vue'
import { useSessionStore } from '@/stores/sessions'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import { usePluginHealth } from '@/composables/usePluginHealth'
import { formatRelativeTime, shortModel } from '@/lib/format'
import type { GitDiffStatFile } from '@shared/ipc-contract'
import type { WorkItem } from '@shared/ipc-contract'
import type { PRDetail } from '@shared/github-types'

const props = defineProps<{
  collapsed: boolean
  rootSessionId: string
}>()
defineEmits<{ collapse: []; expand: [] }>()

const store = useSessionStore()
const { projects } = useProjectsQuery()

const { isHealthy: githubHealthy } = usePluginHealth('github')
const { isHealthy: jiraHealthy } = usePluginHealth('jira')

const rootSession = computed(() => store.getSession(props.rootSessionId))

// Repo slug ('owner/repo') from the project registry, used for PR lookups.
const githubRepo = computed(
  () => projects.value.find((p) => p.path === rootSession.value?.projectPath)?.repo ?? null,
)

// ─── Derived stats ────────────────────────────────────────────────────────────

const turnCount = computed(() => {
  const fromEvents = rootSession.value?.events.filter((e) => e.kind === 'assistant').length ?? 0
  const persisted = store.sessionTurns[props.rootSessionId] ?? 0
  // Use whichever is larger: events-based is accurate for live sessions,
  // persisted is accurate after a restart when events haven't been loaded yet.
  return Math.max(fromEvents, persisted)
})

const tokenData = computed(() => store.sessionTokens[props.rootSessionId])
const tokens = computed(
  () =>
    (tokenData.value?.tokens ?? 0) +
    (store.sessionRunTokens[props.rootSessionId] ?? 0) +
    (store.sessionOutputEstimates[props.rootSessionId] ?? 0),
)
const costUsd = computed(() => tokenData.value?.costUsd ?? 0)

function formatCost(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

// ─── PR card ─────────────────────────────────────────────────────────────────

const prDetail = ref<PRDetail | null>(null)
const prLoading = ref(false)

async function fetchPR() {
  const branch = rootSession.value?.branch
  const repo = githubRepo.value
  if (!branch || !repo || !githubHealthy.value) {
    prDetail.value = null
    return
  }
  prLoading.value = true
  try {
    const list = await window.agentkeeper.github.listPRs({ state: 'all', repo })
    const match = list.find((pr) => pr.headRef === branch)
    if (match) {
      prDetail.value = await window.agentkeeper.github.getPR(repo, match.number)
    } else {
      prDetail.value = null
    }
  } catch {
    prDetail.value = null
  } finally {
    prLoading.value = false
  }
}

function newPRUrl(): string {
  const repo = githubRepo.value
  const branch = rootSession.value?.branch
  if (!repo || !branch) return ''
  return `https://github.com/${repo}/compare/${branch}`
}

const prStateClass: Record<string, string> = {
  open:   'bg-green-500/20 text-green-400',
  closed: 'bg-red-500/20 text-red-400',
  merged: 'bg-purple-500/20 text-purple-400',
}

// ─── Jira ticket detail ───────────────────────────────────────────────────────

const workItem = ref<WorkItem | null>(null)
const workItemLoading = ref(false)

async function fetchWorkItem() {
  const key = rootSession.value?.workItemKey
  if (!key || !jiraHealthy.value) {
    workItem.value = null
    return
  }
  workItemLoading.value = true
  try {
    workItem.value = (await window.agentkeeper.workItems.get(key)) ?? null
  } catch {
    workItem.value = null
  } finally {
    workItemLoading.value = false
  }
}

function priorityClass(priority: string | undefined): string {
  switch (priority?.toLowerCase()) {
    case 'highest':
    case 'critical': return 'bg-destructive/15 text-destructive'
    case 'high':     return 'bg-orange-500/15 text-orange-500'
    case 'medium':   return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'low':      return 'bg-blue-500/15 text-blue-500'
    case 'lowest':
    case 'trivial':  return 'bg-muted text-muted-foreground'
    default:         return 'bg-muted text-muted-foreground'
  }
}

function priorityLabel(priority: string | undefined): string {
  if (!priority) return '?'
  // Abbreviate to one letter: High → H, Medium → M, Low → L, etc.
  return priority[0]?.toUpperCase() ?? '?'
}

// ─── Files changed (git diff stat) ───────────────────────────────────────────

const diffFiles = ref<GitDiffStatFile[]>([])
const diffLoading = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function fetchDiff() {
  const wt = rootSession.value?.worktreePath
  if (!wt) {
    diffFiles.value = []
    return
  }
  diffLoading.value = true
  try {
    diffFiles.value = await window.agentkeeper.worktrees.gitDiffStat(wt)
  } catch {
    // Non-fatal — leave previous results in place
  } finally {
    diffLoading.value = false
  }
}

function scheduleFetch() {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { void fetchDiff() }, 2000)
}

onMounted(() => {
  if (rootSession.value?.worktreePath) void fetchDiff()
  void fetchPR()
  void fetchWorkItem()
})

onUnmounted(() => {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
})

// Re-fetch git diff ~2 s after the last activity tick
watch(() => rootSession.value?.lastActivityAt, (val, prev) => {
  if (val !== prev && rootSession.value?.worktreePath) scheduleFetch()
})

// Reset and re-fetch everything when the session changes (navigation)
watch(() => props.rootSessionId, () => {
  if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null }
  diffFiles.value = []
  prDetail.value = null
  workItem.value = null
  if (rootSession.value?.worktreePath) void fetchDiff()
  void fetchPR()
  void fetchWorkItem()
})

function truncatePath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 3) return filePath
  return `…/${parts.slice(-3).join('/')}`
}

// Electron intercepts window.open via setWindowOpenHandler → shell.openExternal.
function openUrl(url: string) {
  if (url) window.open(url, '_blank')
}
</script>

<template>
  <!-- Collapsed strip — just an expand button on the right edge -->
  <div
    v-if="collapsed"
    class="w-7 shrink-0 flex flex-col items-center pt-2 border-l border-border"
  >
    <button
      class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
      title="Expand context panel"
      @click="$emit('expand')"
    >
      <ChevronLeft class="size-3.5" />
    </button>
  </div>

  <!-- Expanded panel -->
  <div
    v-else
    class="w-[250px] shrink-0 flex flex-col border-l border-border overflow-hidden"
  >
    <!-- Panel header -->
    <div
      class="px-3 py-2 shrink-0 flex items-center justify-between border-b border-border bg-background z-10"
    >
      <span
        class="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5"
      >
        <Layers class="size-3" />
        Context
      </span>
      <button
        class="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded"
        title="Collapse context panel"
        @click="$emit('collapse')"
      >
        <ChevronRight class="size-3.5" />
      </button>
    </div>

    <!-- Scrollable sections -->
    <div class="flex-1 overflow-y-auto divide-y divide-border/40">

      <!-- ── JIRA TICKET ────────────────────────────────────────────────────── -->
      <section v-if="rootSession?.workItemKey" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <Tag class="size-3" />
          Jira Ticket
        </div>

        <!-- Title — prefer fetched workItem title, fall back to session field -->
        <div class="text-[11px] font-medium text-foreground leading-snug mb-1.5">
          {{ workItem?.title ?? rootSession.workItemTitle ?? rootSession.workItemKey }}
        </div>

        <!-- Key + priority badge -->
        <div class="flex items-center gap-1.5 mb-2">
          <span class="text-[11px] font-mono text-muted-foreground">
            {{ rootSession.workItemKey }}
          </span>
          <span
            class="inline-flex items-center rounded px-1 py-0 text-[10px] font-medium"
            :class="workItem ? priorityClass(workItem.priority) : 'bg-muted text-muted-foreground'"
            :title="workItem?.priority ?? 'Priority unknown'"
          >
            {{ workItem ? priorityLabel(workItem.priority) : '?' }}
          </span>
        </div>

        <!-- Detail rows -->
        <div class="space-y-1 text-[11px]">
          <!-- Epic: parentRef if the issue is a story/task under an epic -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Epic</span>
            <span class="text-foreground font-mono truncate text-right">
              {{ workItem?.parentRef ?? '—' }}
            </span>
          </div>
          <!-- Sprint: not in WorkItem type; stays — until plugin exposes it -->
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Sprint</span>
            <span class="text-foreground">—</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Points</span>
            <span class="text-foreground tabular-nums">
              {{ workItem?.storyPoints ?? '—' }}
            </span>
          </div>
        </div>
      </section>

      <!-- ── BRANCH & PR ─────────────────────────────────────────────────────── -->
      <section v-if="rootSession?.branch" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <GitBranch class="size-3" />
          Branch &amp; PR
        </div>

        <!-- Branch name always shown -->
        <div class="flex items-center gap-1.5 mb-2.5">
          <GitBranch class="size-3 shrink-0 text-muted-foreground" />
          <span class="text-[11px] font-mono text-foreground truncate">
            {{ rootSession.branch }}
          </span>
        </div>

        <!-- PR card — GitHub plugin healthy + repo known + PR found -->
        <button
          v-if="githubHealthy && githubRepo && prDetail"
          class="w-full text-left rounded border border-border/60 px-2.5 py-2 hover:bg-muted/50 transition-colors"
          :title="`Open PR #${prDetail.number} on GitHub`"
          @click="openUrl(prDetail.url)"
        >
          <!-- State badge + number -->
          <div class="flex items-center gap-1.5 mb-1">
            <span
              class="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-medium"
              :class="prStateClass[prDetail.state] ?? 'bg-muted text-muted-foreground'"
            >
              {{ prDetail.state }}
            </span>
            <span class="text-[11px] text-muted-foreground">#{{ prDetail.number }}</span>
            <span v-if="prDetail.isDraft" class="text-[10px] text-muted-foreground italic">draft</span>
          </div>
          <!-- Title -->
          <div class="text-[11px] font-medium text-foreground leading-snug mb-1.5 line-clamp-2">
            {{ prDetail.title }}
          </div>
          <!-- Stats row -->
          <div class="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span class="text-emerald-500">+{{ prDetail.additions }}</span>
            <span class="text-destructive">-{{ prDetail.deletions }}</span>
            <span>· {{ prDetail.changedFiles }} files</span>
          </div>
        </button>

        <!-- Loading state -->
        <div
          v-else-if="githubHealthy && githubRepo && prLoading"
          class="text-[11px] text-muted-foreground/50 italic"
        >
          Loading PR…
        </div>

        <!-- No PR found — show "Open pull request" button with pre-filled URL -->
        <button
          v-else-if="githubHealthy && githubRepo && !prLoading"
          class="text-[11px] text-primary hover:underline"
          :title="`Open pull request for ${rootSession.branch}`"
          @click="openUrl(newPRUrl())"
        >
          Open pull request ↗
        </button>
        <!-- If GitHub not configured, branch name alone is sufficient (no PR actions) -->
      </section>

      <!-- ── FILES CHANGED ──────────────────────────────────────────────────── -->
      <section v-if="rootSession?.worktreePath" class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 flex items-center gap-1.5"
        >
          <FileCode2 class="size-3" />
          Files Changed
          <span v-if="diffFiles.length > 0" class="ml-auto font-normal normal-case tracking-normal">
            · {{ diffFiles.length }}
          </span>
        </div>

        <!-- File rows -->
        <div v-if="diffFiles.length > 0" class="space-y-1">
          <div
            v-for="f in diffFiles"
            :key="f.file"
            class="flex items-center gap-1.5 text-[11px]"
            :title="f.file"
          >
            <span class="flex-1 text-foreground truncate font-mono">{{ truncatePath(f.file) }}</span>
            <span v-if="f.added > 0" class="text-emerald-500 tabular-nums shrink-0">+{{ f.added }}</span>
            <span v-if="f.removed > 0" class="text-destructive tabular-nums shrink-0">-{{ f.removed }}</span>
          </div>
        </div>

        <div v-else-if="diffLoading" class="text-[11px] text-muted-foreground/50 italic">
          Loading…
        </div>
        <div v-else class="text-[11px] text-muted-foreground/50 italic">
          No changes detected
        </div>
      </section>

      <!-- ── SESSION ────────────────────────────────────────────────────────── -->
      <section class="px-3 py-3">
        <div
          class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2"
        >
          Session
        </div>
        <div class="space-y-1 text-[11px]">
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Model</span>
            <span class="font-mono text-primary truncate text-right">
              {{ shortModel(rootSession?.model ?? null) ?? '—' }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Turns</span>
            <span class="tabular-nums text-foreground">{{ turnCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Tokens</span>
            <span class="tabular-nums text-foreground">{{ tokens.toLocaleString() }}</span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <span class="text-muted-foreground shrink-0 flex items-center gap-1">
              Cost
              <TokenBreakdownPopover :session-id="rootSessionId" side="left" />
            </span>
            <span class="tabular-nums text-foreground">{{ formatCost(costUsd) }}</span>
          </div>
          <div class="flex items-start justify-between gap-2">
            <span class="text-muted-foreground shrink-0">Started</span>
            <span class="text-foreground text-right">
              {{ rootSession ? formatRelativeTime(rootSession.startedAt) : '—' }}
            </span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
