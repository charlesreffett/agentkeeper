<script setup lang="ts">
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import FileTree from '@/components/FileTree.vue'
import GitChanges from '@/components/GitChanges.vue'

const props = defineProps<{ projectPath: string }>()
</script>

<template>
  <div class="w-72 shrink-0 border-l bg-background flex flex-col overflow-hidden">
    <Tabs default-value="files" class="flex flex-col flex-1 min-h-0">
      <TabsList class="mx-2 mt-2 w-auto">
        <TabsTrigger value="files">Files</TabsTrigger>
        <TabsTrigger value="changes">Git Changes</TabsTrigger>
      </TabsList>
      <TabsContent value="files" class="flex-1 overflow-auto p-2">
        <FileTree :root-path="props.projectPath" />
      </TabsContent>
      <TabsContent value="changes" class="flex-1 overflow-auto p-2">
        <GitChanges :project-path="props.projectPath" />
      </TabsContent>
    </Tabs>
  </div>
</template>
