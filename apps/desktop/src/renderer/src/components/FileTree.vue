<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import FileTreeNode from '@/components/FileTreeNode.vue'

const props = defineProps<{ rootPath: string }>()

interface Entry {
  name: string
  path: string
  isDirectory: boolean
}

const entries = ref<Entry[]>([])

async function load() {
  if (!props.rootPath) return
  const result = await (window.orchestral as any).fs?.listDirectory(props.rootPath)
  if (result) entries.value = result
}

onMounted(load)
watch(() => props.rootPath, load)
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
    />
  </div>
</template>
