<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { GitBranch, ChevronDown, Star, Plus, Check, Loader2, Eye, EyeOff, ArrowDownToLine, ArrowUpFromLine, GitCommitHorizontal } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { useGitBranches } from '@/composables/useGitBranches'
import { useLayoutStore } from '@/stores/layout'
import { useRightPanelStore } from '@/stores/rightPanel'
import type { BranchInfo } from '@shared/ipc-contract'

const props = defineProps<{ projectPath: string | null }>()

const layoutStore = useLayoutStore()
const rightPanelStore = useRightPanelStore()

const {
  branches,
  pinnedBranches,
  currentBranch,
  refetch,
  switchBranchInteractive,
  isSwitching,
  createBranch,
  togglePin,
} = useGitBranches(computed(() => props.projectPath))

const open = ref(false)

watch(open, (isOpen) => {
  if (isOpen) {
    creating.value = false
    newBranchName.value = ''
    void refetch()
  }
})

const showWorktrees = ref(false)
const MAX_RECENT = 5

// Local-only, JetBrains-style — remotes belong in a fuller view.
const locals = computed(() => branches.value.filter((b) => !b.isRemote))

// Worktree-checked-out branches can't be switched to anyway — noise by default.
const worktreeCount = computed(() => locals.value.filter((b) => b.worktreePath).length)
const filtered = computed(() =>
  showWorktrees.value ? locals.value : locals.value.filter((b) => !b.worktreePath),
)

const pinnedSet = computed(() => new Set(pinnedBranches.value))

// Default → Pinned → Recent.
const defaultRows = computed(() => filtered.value.filter((b) => b.isDefault))
const pinnedRows = computed(() =>
  filtered.value.filter((b) => !b.isDefault && pinnedSet.value.has(b.name)),
)
const recentRows = computed(() =>
  filtered.value
    .filter((b) => !b.isDefault && !pinnedSet.value.has(b.name) && (b.recentRank !== null || b.isCurrent))
    .sort((a, b) => (a.recentRank ?? -1) - (b.recentRank ?? -1))
    .slice(0, MAX_RECENT),
)

const groups = computed(() => [
  { label: 'Default', rows: defaultRows.value },
  { label: 'Pinned', rows: pinnedRows.value },
  { label: 'Recent', rows: recentRows.value },
])

const visibleCount = computed(() => groups.value.reduce((n, g) => n + g.rows.length, 0))

const currentLabel = computed(() => {
  if (!props.projectPath) return '—'
  return currentBranch.value?.name ?? 'detached'
})

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d`
  return new Date(iso).toLocaleDateString()
}

async function onSelect(branch: BranchInfo): Promise<void> {
  if (branch.isCurrent || branch.worktreePath || isSwitching.value) return
  const switched = await switchBranchInteractive(branch.name)
  if (switched) open.value = false
}

const pulling = ref(false)
const pushing = ref(false)

async function gitPull(): Promise<void> {
  if (!props.projectPath || pulling.value) return
  pulling.value = true
  try {
    await window.agentkeeper.git.pull(props.projectPath)
    toast.success('git pull succeeded')
    void refetch()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'git pull failed')
  } finally {
    pulling.value = false
  }
}

async function gitPush(): Promise<void> {
  if (!props.projectPath || pushing.value) return
  pushing.value = true
  try {
    const output = await window.agentkeeper.git.push(props.projectPath)
    toast.success('git push succeeded', { description: output || undefined })
    void refetch()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'git push failed')
  } finally {
    pushing.value = false
  }
}

function openCommit(): void {
  if (!layoutStore.rightPanelOpen) layoutStore.toggleRightPanel()
  rightPanelStore.openGitChanges()
  open.value = false
}

const creating = ref(false)
const newBranchName = ref('')
const newBranchInput = ref<HTMLInputElement | null>(null)

function startCreate(): void {
  creating.value = true
  newBranchName.value = ''
  void nextTick(() => newBranchInput.value?.focus())
}

async function onCreate(): Promise<void> {
  const name = newBranchName.value.trim()
  if (!name) return
  if (locals.value.some((b) => b.name === name)) {
    toast.error(`Branch ${name} already exists`)
    return
  }
  const result = await createBranch(name)
  if (result.ok) {
    toast.success(`Created and switched to ${name}`)
    open.value = false
  } else if (result.blocked === 'live-session') {
    toast.error('A session is running in this project — stop it before switching branches.')
  } else if (result.blocked === 'git-error' || result.blocked === 'conflict') {
    toast.error('Failed to create branch', { description: result.reason })
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        class="h-7 px-2 text-xs gap-1.5 text-muted-foreground font-normal min-w-0"
        :disabled="!projectPath"
      >
        <GitBranch class="h-3.5 w-3.5 shrink-0" />
        <span class="max-w-40 min-w-0 truncate">{{ currentLabel }}</span>
        <Loader2 v-if="isSwitching" class="h-3 w-3 shrink-0 animate-spin" />
        <ChevronDown v-else class="h-3 w-3 shrink-0" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 p-0">
      <div class="p-1 border-b">
        <button
          class="flex items-center gap-2 w-full px-2 py-1 text-sm rounded hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="pulling"
          @click="void gitPull()"
        >
          <Loader2 v-if="pulling" class="h-3.5 w-3.5 shrink-0 animate-spin" />
          <ArrowDownToLine v-else class="h-3.5 w-3.5 shrink-0" />
          Pull
        </button>
        <button
          class="flex items-center gap-2 w-full px-2 py-1 text-sm rounded hover:bg-accent transition-colors"
          @click="openCommit"
        >
          <GitCommitHorizontal class="h-3.5 w-3.5 shrink-0" />
          Commit…
        </button>
        <button
          class="flex items-center gap-2 w-full px-2 py-1 text-sm rounded hover:bg-accent transition-colors disabled:opacity-50"
          :disabled="pushing"
          @click="void gitPush()"
        >
          <Loader2 v-if="pushing" class="h-3.5 w-3.5 shrink-0 animate-spin" />
          <ArrowUpFromLine v-else class="h-3.5 w-3.5 shrink-0" />
          Push
        </button>
        <button
          v-if="!creating"
          class="flex items-center gap-2 w-full px-2 py-1 text-sm rounded hover:bg-accent transition-colors"
          @click="startCreate"
        >
          <Plus class="h-3.5 w-3.5 shrink-0" />
          New Branch…
        </button>
        <div v-else class="flex items-center gap-2 px-2 py-1">
          <Plus class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            ref="newBranchInput"
            v-model="newBranchName"
            type="text"
            placeholder="Branch name…"
            class="flex-1 min-w-0 rounded border border-input bg-background px-1.5 py-0.5 text-sm focus:outline-none focus:border-ring"
            @keydown.enter="void onCreate()"
            @keydown.esc="creating = false"
          />
        </div>
      </div>

      <div class="max-h-56 overflow-y-auto p-1">
        <template v-for="(group, gi) in groups" :key="group.label">
          <template v-if="group.rows.length">
            <Separator v-if="groups.slice(0, gi).some((g) => g.rows.length)" class="my-1" />
            <div class="px-2 py-0.5 text-xs text-muted-foreground font-medium">{{ group.label }}</div>
            <div
              v-for="branch in group.rows"
              :key="branch.name"
              class="group flex items-center gap-2 w-full px-2 py-1 text-sm rounded transition-colors"
              :class="branch.isCurrent || branch.worktreePath
                ? 'opacity-60'
                : 'hover:bg-accent cursor-pointer'"
              @click="void onSelect(branch)"
            >
              <span class="w-4 shrink-0 flex items-center justify-center">
                <Check v-if="branch.isCurrent" class="h-3.5 w-3.5 text-primary" />
                <GitBranch v-else class="h-3.5 w-3.5 text-muted-foreground" />
              </span>
              <span class="truncate flex-1 min-w-0" :title="branch.name">{{ branch.name }}</span>
              <span
                v-if="branch.isDefault"
                class="shrink-0 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground"
              >
                default
              </span>
              <span
                v-if="branch.worktreePath"
                class="shrink-0 text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground"
                :title="`Checked out in ${branch.worktreePath}`"
              >
                +worktree
              </span>
              <span
                v-if="branch.ahead || branch.behind"
                class="shrink-0 text-[10px] text-muted-foreground tabular-nums"
                title="Ahead/behind upstream, as of last fetch"
              >
                <template v-if="branch.ahead">↑{{ branch.ahead }}</template>
                <template v-if="branch.behind">↓{{ branch.behind }}</template>
              </span>
              <span class="shrink-0 text-[10px] text-muted-foreground/70">{{ relativeTime(branch.lastCommitDate) }}</span>
              <button
                v-if="!branch.isRemote"
                class="shrink-0 size-5 flex items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground"
                :class="pinnedSet.has(branch.name) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                :title="pinnedSet.has(branch.name) ? 'Unpin' : 'Pin'"
                @click.stop="void togglePin(branch.name)"
              >
                <Star class="h-3 w-3" :class="pinnedSet.has(branch.name) ? 'fill-current' : ''" />
              </button>
            </div>
          </template>
        </template>

        <div v-if="!visibleCount" class="px-2 py-3 text-xs text-muted-foreground text-center">
          No branches
        </div>

        <button
          v-if="worktreeCount > 0"
          class="flex items-center gap-2 w-full px-2 py-1 mt-0.5 text-xs text-muted-foreground rounded hover:bg-accent hover:text-foreground transition-colors"
          @click="showWorktrees = !showWorktrees"
        >
          <component :is="showWorktrees ? EyeOff : Eye" class="h-3 w-3 shrink-0" />
          {{ showWorktrees ? 'Hide' : 'Show' }} {{ worktreeCount }} worktree {{ worktreeCount === 1 ? 'branch' : 'branches' }}
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
