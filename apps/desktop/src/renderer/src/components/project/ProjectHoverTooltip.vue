<script setup lang="ts">
import { Folder, MessageCircle } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  project: { name: string; path: string }
  sessionCount: number
  disabled?: boolean
}>()
</script>

<template>
  <TooltipProvider :delay-duration="500">
    <Tooltip :disabled="disabled">
      <TooltipTrigger as-child>
        <slot name="trigger" />
      </TooltipTrigger>
      <TooltipContent side="right" align="start" :side-offset="8" class="w-64 p-0">
        <div class="space-y-2 px-3 py-3">
          <div class="flex items-center gap-2 text-sm font-medium">
            <Folder class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{{ project.name }}</span>
          </div>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <MessageCircle class="size-4 shrink-0" />
            {{ sessionCount }} session{{ sessionCount === 1 ? '' : 's' }}
          </div>
        </div>
        <div class="border-t border-border px-3 py-2 text-xs font-mono text-muted-foreground break-all">
          {{ project.path }}
        </div>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
