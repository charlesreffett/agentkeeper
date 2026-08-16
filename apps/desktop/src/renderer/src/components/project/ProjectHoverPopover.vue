<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Folder, MessageCircle, Settings } from 'lucide-vue-next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { RecentProject } from '@shared/ipc-contract'

const props = defineProps<{ project: RecentProject; sessionCount: number; disabled?: boolean }>()
const emit = defineEmits<{ edit: [] }>()

const open = ref(false)
const anchorElement = ref<HTMLSpanElement | null>(null)
let hoverTarget: HTMLElement | null = null
let openTimer: ReturnType<typeof setTimeout> | null = null
let closeTimer: ReturnType<typeof setTimeout> | null = null

function clearTimers() {
  if (openTimer) clearTimeout(openTimer)
  if (closeTimer) clearTimeout(closeTimer)
  openTimer = null
  closeTimer = null
}

function scheduleOpen() {
  if (props.disabled) return
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
  if (open.value || openTimer) return
  openTimer = setTimeout(() => {
    open.value = true
    openTimer = null
  }, 1000)
}

watch(() => props.disabled, (disabled) => {
  if (!disabled) return
  clearTimers()
  open.value = false
})

function scheduleClose() {
  if (openTimer) clearTimeout(openTimer)
  openTimer = null
  if (!open.value) return
  closeTimer = setTimeout(() => {
    open.value = false
    closeTimer = null
  }, 150)
}

function edit() {
  open.value = false
  emit('edit')
}

onMounted(() => {
  hoverTarget = anchorElement.value?.closest<HTMLElement>('[data-project-row]') ?? null
  hoverTarget?.addEventListener('pointerenter', scheduleOpen)
  hoverTarget?.addEventListener('pointerleave', scheduleClose)
})

onUnmounted(() => {
  clearTimers()
  hoverTarget?.removeEventListener('pointerenter', scheduleOpen)
  hoverTarget?.removeEventListener('pointerleave', scheduleClose)
})
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <span ref="anchorElement" class="pointer-events-none absolute right-0 top-0 size-px" />
    </PopoverTrigger>
    <PopoverContent
      side="right"
      align="start"
      :side-offset="8"
      class="w-64 p-0"
      @pointerenter="scheduleOpen"
      @pointerleave="scheduleClose"
      @open-auto-focus.prevent
    >
      <div class="space-y-2 px-3 py-3">
        <div class="flex items-center gap-2 text-sm font-medium">
          <Folder class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ props.project.name }}</span>
        </div>
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <MessageCircle class="size-4 shrink-0" />
          {{ props.sessionCount }} session{{ props.sessionCount === 1 ? '' : 's' }}
        </div>
      </div>
      <div class="border-t border-border px-3 py-2 text-xs font-mono text-muted-foreground break-all">
        {{ props.project.path }}
      </div>
      <div class="border-t border-border p-1">
        <button class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent" @click="edit">
          <Settings class="mr-2 size-4 text-muted-foreground" />
          Edit project
        </button>
      </div>
    </PopoverContent>
  </Popover>
</template>
