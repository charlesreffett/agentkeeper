<script setup lang="ts">
import { Button } from '@/components/ui/button'
import type { RecentProject } from '@shared/ipc-contract'

defineProps<{ project: RecentProject }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <div class="h-full flex flex-col">
    <header
      class="border-b border-border px-6 py-3 flex items-center gap-4 shrink-0"
    >
      <Button variant="ghost" size="sm" @click="emit('close')">← Back</Button>
      <div class="min-w-0">
        <div class="font-medium truncate">{{ project.name }}</div>
        <div class="text-xs text-muted-foreground truncate">
          {{ project.path }}
        </div>
      </div>
    </header>
    <main class="flex-1 p-8 overflow-auto">
      <div class="max-w-2xl mx-auto space-y-4 text-muted-foreground">
        <p>Project opened.</p>
        <p class="text-sm">
          Session viewer lands in <span class="font-mono text-foreground">V1</span>,
          live sessions in <span class="font-mono text-foreground">V2</span>.
        </p>
      </div>
    </main>
  </div>
</template>
