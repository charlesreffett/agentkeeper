<script setup lang="ts">
import { ref, watch } from 'vue'
import { ChevronRight, Folder, File } from 'lucide-vue-next'

interface Entry {
  name: string
  path: string
  isDirectory: boolean
}

const props = defineProps<{
  entry: Entry
  refreshKey?: number
}>()

const expanded = ref(false)
const children = ref<Entry[]>([])

async function loadChildren() {
  const result = await (window.agentkeeper as any).fs?.listDirectory(props.entry.path)
  if (result) children.value = result
}

async function toggle() {
  if (!props.entry.isDirectory) return
  expanded.value = !expanded.value
  if (expanded.value && children.value.length === 0) {
    await loadChildren()
  }
}

watch(() => props.refreshKey, () => {
  if (expanded.value && props.entry.isDirectory) {
    loadChildren()
  }
})
</script>

<template>
  <div>
    <button
      class="flex items-center gap-1 hover:bg-muted/50 w-full px-1 py-0.5 rounded text-left"
      @click="toggle"
    >
      <ChevronRight
        v-if="entry.isDirectory"
        class="h-3 w-3 transition-transform shrink-0"
        :class="{ 'rotate-90': expanded }"
      />
      <span v-else class="w-3 shrink-0" />
      <Folder v-if="entry.isDirectory" class="h-3.5 w-3.5 text-amber-500 shrink-0" />
      <File v-else class="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span class="truncate">{{ entry.name }}</span>
    </button>
    <div v-if="expanded && entry.isDirectory" class="pl-3">
      <FileTreeNode
        v-for="child in children"
        :key="child.path"
        :entry="child"
        :refresh-key="refreshKey"
      />
    </div>
  </div>
</template>
