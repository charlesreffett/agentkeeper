<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import FileTreeNode from '@/components/FileTreeNode.vue'

const props = defineProps<{ rootPath: string }>()

interface Entry {
  name: string
  path: string
  isDirectory: boolean
}

interface GitStatus {
  staged: { path: string; status: string }[]
  unstaged: { path: string; status: string }[]
  untracked: string[]
}

const entries = ref<Entry[]>([])
const refreshKey = ref(0)
const statusMap = ref<Record<string, string>>({})

const STATUS_PRIORITY: Record<string, number> = {
  'text-red-400': 3,
  'text-amber-400': 2,
  'text-green-400': 1,
}

function colorForStatus(status: string): string {
  if (status === 'D') return 'text-red-400'
  if (status === 'M' || status === 'U') return 'text-amber-400'
  return 'text-green-400'
}

function buildStatusMap(rootPath: string, status: GitStatus): Record<string, string> {
  const map: Record<string, string> = {}

  function setWithPriority(absPath: string, color: string) {
    const existing = map[absPath]
    if (!existing || (STATUS_PRIORITY[color] ?? 0) > (STATUS_PRIORITY[existing] ?? 0)) {
      map[absPath] = color
    }
  }

  function markAncestors(relPath: string, color: string) {
    const parts = relPath.split('/')
    for (let i = 1; i < parts.length; i++) {
      setWithPriority(`${rootPath}/${parts.slice(0, i).join('/')}`, color)
    }
  }

  for (const relPath of status.untracked) {
    setWithPriority(`${rootPath}/${relPath}`, 'text-green-400')
    markAncestors(relPath, 'text-green-400')
  }

  for (const change of status.unstaged) {
    const color = colorForStatus(change.status)
    setWithPriority(`${rootPath}/${change.path}`, color)
    markAncestors(change.path, color)
  }

  for (const change of status.staged) {
    const color = colorForStatus(change.status)
    setWithPriority(`${rootPath}/${change.path}`, color)
    markAncestors(change.path, color)
  }

  return map
}

async function load() {
  if (!props.rootPath) return
  const result = await (window.agentkeeper as any).fs?.listDirectory(props.rootPath)
  if (result) entries.value = result
}

async function loadStatus() {
  if (!props.rootPath) return
  const status: GitStatus | undefined = await (window.agentkeeper as any).git?.getStatus(props.rootPath)
  statusMap.value = status ? buildStatusMap(props.rootPath, status) : {}
}

let unsubscribeFs: (() => void) | null = null
let unsubscribeGit: (() => void) | null = null
let watchedPath: string | null = null

async function startWatch(rootPath: string): Promise<void> {
  await window.agentkeeper.fs.watchStart(rootPath)
  unsubscribeFs = window.agentkeeper.fs.onChanged((event) => {
    if (event.projectPath === rootPath) {
      load()
      refreshKey.value++
    }
  })
  unsubscribeGit = window.agentkeeper.git.onStatusChanged((event) => {
    if (event.projectPath === rootPath) loadStatus()
  })
  watchedPath = rootPath
}

async function stopWatch(): Promise<void> {
  unsubscribeFs?.()
  unsubscribeFs = null
  unsubscribeGit?.()
  unsubscribeGit = null
  if (watchedPath) {
    await window.agentkeeper.fs.watchStop(watchedPath)
    watchedPath = null
  }
}

onMounted(async () => {
  await Promise.all([load(), loadStatus()])
  if (props.rootPath) await startWatch(props.rootPath)
})

watch(() => props.rootPath, async (newPath, oldPath) => {
  if (oldPath) await stopWatch()
  await Promise.all([load(), loadStatus()])
  if (newPath) await startWatch(newPath)
})

onUnmounted(async () => {
  await stopWatch()
})
</script>

<template>
  <div class="text-sm font-mono">
    <div v-if="entries.length === 0" class="text-xs text-muted-foreground px-1 py-2">
      No files
    </div>
    <FileTreeNode
      v-for="entry in entries"
      :key="entry.path"
      :entry="entry"
      :refresh-key="refreshKey"
      :status-map="statusMap"
    />
  </div>
</template>
