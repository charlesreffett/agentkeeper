<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import GitCommitPanel from '@/components/GitCommitPanel.vue'

const props = defineProps<{ projectPath: string; autoAnalyze?: number }>()

interface Change {
  path: string
  status: string
}

interface GitStatus {
  staged: Change[]
  unstaged: Change[]
  untracked: string[]
}

interface DirNode {
  type: 'dir'
  name: string
  children: (DirNode | FileNode)[]
}

interface FileNode {
  type: 'file'
  name: string
  fullPath: string
  status: string
}

interface FlatNode {
  key: string
  type: 'dir' | 'file'
  name: string
  depth: number
  status: string
}

const gitStatus = ref<GitStatus>({ staged: [], unstaged: [], untracked: [] })
const loading = ref(false)

async function load() {
  if (!props.projectPath) return
  loading.value = true
  try {
    const result = await (window.agentkeeper as any).git?.getStatus(props.projectPath)
    if (result) gitStatus.value = result
  } finally {
    loading.value = false
  }
}

const statusColor: Record<string, string> = {
  M: 'text-blue-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-yellow-400',
}

function buildTrie(files: Change[]): (DirNode | FileNode)[] {
  const root: DirNode = { type: 'dir', name: '', children: [] }

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split('/')
    const fileName = parts.pop()!
    let node = root
    for (const part of parts) {
      let child = node.children.find((c): c is DirNode => c.type === 'dir' && c.name === part)
      if (!child) {
        child = { type: 'dir', name: part, children: [] }
        node.children.push(child)
      }
      node = child
    }
    node.children.push({ type: 'file', name: fileName, fullPath: file.path, status: file.status })
  }

  return root.children
}

function flatten(nodes: (DirNode | FileNode)[], depth = 0): FlatNode[] {
  const out: FlatNode[] = []
  for (const n of nodes) {
    if (n.type === 'dir') {
      out.push({ key: `d:${depth}:${n.name}`, type: 'dir', name: n.name, depth, status: '' })
      out.push(...flatten(n.children, depth + 1))
    } else {
      out.push({ key: `f:${n.fullPath}`, type: 'file', name: n.name, depth, status: n.status })
    }
  }
  return out
}

const staged = computed(() => flatten(buildTrie(gitStatus.value.staged)))
const unstaged = computed(() => flatten(buildTrie(gitStatus.value.unstaged)))
const untracked = computed(() =>
  flatten(buildTrie(gitStatus.value.untracked.map((p) => ({ path: p, status: '?' })))),
)

const empty = computed(
  () =>
    gitStatus.value.staged.length === 0 &&
    gitStatus.value.unstaged.length === 0 &&
    gitStatus.value.untracked.length === 0,
)

let unsubscribeGitStatus: (() => void) | null = null
let watchedPath: string | null = null

async function startWatch(projectPath: string): Promise<void> {
  await window.agentkeeper.fs.watchStart(projectPath)
  unsubscribeGitStatus = window.agentkeeper.git.onStatusChanged((event) => {
    if (event.projectPath === projectPath) {
      load()
    }
  })
  watchedPath = projectPath
}

async function stopWatch(): Promise<void> {
  unsubscribeGitStatus?.()
  unsubscribeGitStatus = null
  if (watchedPath) {
    await window.agentkeeper.fs.watchStop(watchedPath)
    watchedPath = null
  }
}

onMounted(async () => {
  await load()
  if (props.projectPath) await startWatch(props.projectPath)
})

watch(() => props.projectPath, async (newPath, oldPath) => {
  if (oldPath) await stopWatch()
  await load()
  if (newPath) await startWatch(newPath)
})

onUnmounted(async () => {
  await stopWatch()
})

function onCommitted() {
  // Refresh status after Claude finishes committing
  load()
}
</script>

<template>
  <div class="text-xs select-none">
    <!-- AI commit panel is always available when there's a project path -->
    <GitCommitPanel
      v-if="props.projectPath"
      :project-path="props.projectPath"
      :auto-analyze="props.autoAnalyze"
      @committed="onCommitted"
    />

    <div v-if="loading" class="text-muted-foreground px-1 py-2">Loading…</div>

    <template v-else>
      <div v-if="empty" class="text-muted-foreground px-1 py-2">No changes</div>

      <template v-else>
        <!-- Staged -->
        <template v-if="staged.length > 0">
          <div
            class="flex items-center gap-1 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest"
          >
            <span class="size-1.5 rounded-full bg-green-500 shrink-0" />
            Staged ({{ gitStatus.staged.length }})
          </div>
          <div
            v-for="node in staged"
            :key="node.key"
            class="flex items-center gap-1.5 py-[3px] rounded-sm"
            :class="node.type === 'file' && 'hover:bg-muted/50 cursor-default'"
            :style="{ paddingLeft: `${node.depth * 10 + 4}px` }"
          >
            <span v-if="node.type === 'dir'" class="text-muted-foreground/50 font-medium">
              {{ node.name }}/
            </span>
            <template v-else>
              <span
                class="font-mono font-bold shrink-0 w-3 text-center leading-none"
                :class="statusColor[node.status] ?? 'text-muted-foreground'"
              >{{ node.status }}</span>
              <span class="truncate text-foreground/75">{{ node.name }}</span>
            </template>
          </div>
        </template>

        <!-- Unstaged -->
        <template v-if="unstaged.length > 0">
          <div
            class="flex items-center gap-1 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest"
          >
            <span class="size-1.5 rounded-full bg-amber-500 shrink-0" />
            Unstaged ({{ gitStatus.unstaged.length }})
          </div>
          <div
            v-for="node in unstaged"
            :key="node.key"
            class="flex items-center gap-1.5 py-[3px] rounded-sm"
            :class="node.type === 'file' && 'hover:bg-muted/50 cursor-default'"
            :style="{ paddingLeft: `${node.depth * 10 + 4}px` }"
          >
            <span v-if="node.type === 'dir'" class="text-muted-foreground/50 font-medium">
              {{ node.name }}/
            </span>
            <template v-else>
              <span
                class="font-mono font-bold shrink-0 w-3 text-center leading-none"
                :class="statusColor[node.status] ?? 'text-muted-foreground'"
              >{{ node.status }}</span>
              <span class="truncate text-foreground/75">{{ node.name }}</span>
            </template>
          </div>
        </template>

        <!-- Untracked -->
        <template v-if="untracked.length > 0">
          <div
            class="flex items-center gap-1 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest"
          >
            <span class="size-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
            Untracked ({{ gitStatus.untracked.length }})
          </div>
          <div
            v-for="node in untracked"
            :key="node.key"
            class="flex items-center gap-1.5 py-[3px] rounded-sm"
            :class="node.type === 'file' && 'hover:bg-muted/50 cursor-default'"
            :style="{ paddingLeft: `${node.depth * 10 + 4}px` }"
          >
            <span v-if="node.type === 'dir'" class="text-muted-foreground/50 font-medium">
              {{ node.name }}/
            </span>
            <template v-else>
              <span class="font-mono font-bold shrink-0 w-3 text-center leading-none text-muted-foreground/60"
                >?</span>
              <span class="truncate text-foreground/60">{{ node.name }}</span>
            </template>
          </div>
        </template>
      </template>
    </template>
  </div>
</template>
