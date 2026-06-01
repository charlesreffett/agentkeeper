<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Eye, EyeOff } from 'lucide-vue-next'
import FileTreeNode from '@/components/FileTreeNode.vue'

const props = defineProps<{ rootPath: string }>()

interface Entry {
  name: string
  path: string
  isDirectory: boolean
}

const entries = ref<Entry[]>([])
const refreshKey = ref(0)
const showHidden = ref(false)

const visibleEntries = computed(() =>
  showHidden.value ? entries.value : entries.value.filter((e) => !e.name.startsWith('.'))
)

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
    <div class="flex items-center justify-end px-1 pb-1">
      <button
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        :title="showHidden ? 'Hide hidden files' : 'Show hidden files'"
        @click="showHidden = !showHidden"
      >
        <EyeOff v-if="showHidden" class="h-3.5 w-3.5" />
        <Eye v-else class="h-3.5 w-3.5" />
      </button>
    </div>
    <div v-if="visibleEntries.length === 0" class="text-xs text-muted-foreground px-1 py-2">
      No files
    </div>
    <FileTreeNode
      v-for="entry in visibleEntries"
      :key="entry.path"
      :entry="entry"
      :refresh-key="refreshKey"
      :show-hidden="showHidden"
    />
  </div>
</template>
