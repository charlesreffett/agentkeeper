<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import FileTreeNode from '@/components/FileTreeNode.vue'

const props = defineProps<{ rootPath: string }>()

interface Entry {
  name: string
  path: string
  isDirectory: boolean
}

const entries = ref<Entry[]>([])
const refreshKey = ref(0)

async function load() {
  if (!props.rootPath) return
  const result = await (window.agentkeeper as any).fs?.listDirectory(props.rootPath)
  if (result) entries.value = result
}

let unsubscribeFs: (() => void) | null = null
let watchedPath: string | null = null

async function startWatch(rootPath: string): Promise<void> {
  await window.agentkeeper.fs.watchStart(rootPath)
  unsubscribeFs = window.agentkeeper.fs.onChanged((event) => {
    if (event.projectPath === rootPath) {
      load()
      refreshKey.value++
    }
  })
  watchedPath = rootPath
}

async function stopWatch(): Promise<void> {
  unsubscribeFs?.()
  unsubscribeFs = null
  if (watchedPath) {
    await window.agentkeeper.fs.watchStop(watchedPath)
    watchedPath = null
  }
}

onMounted(async () => {
  await load()
  if (props.rootPath) await startWatch(props.rootPath)
})

watch(() => props.rootPath, async (newPath, oldPath) => {
  if (oldPath) await stopWatch()
  await load()
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
    />
  </div>
</template>
