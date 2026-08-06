<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref } from 'vue'
import { X, RotateCcw, Plus } from 'lucide-vue-next'
import { useTerminalStore } from '@/stores/terminalStore'
import { useSessionStore } from '@/stores/sessions'
import { isGeneralProject } from '@shared/ipc-contract'
import TerminalInstance from '@/components/TerminalInstance.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

const terminalStore = useTerminalStore()
const sessionStore = useSessionStore()

const root = ref<HTMLDivElement | null>(null)
const activeKey = computed(() => terminalStore.activeKey)

const editingKey = ref<string | null>(null)
const editValue = ref('')
let editInput: HTMLInputElement | null = null

function setEditRef(el: unknown): void {
  if (el instanceof HTMLInputElement) editInput = el
}

async function startRename(key: string, title: string): Promise<void> {
  editingKey.value = key
  editValue.value = title
  await nextTick()
  editInput?.select()
}

function commitRename(): void {
  if (editingKey.value) terminalStore.renameTab(editingKey.value, editValue.value)
  editingKey.value = null
}

function cancelRename(): void {
  editingKey.value = null
}

function projectBase(): string {
  const active = sessionStore.currentSession?.projectPath
  if (!active || isGeneralProject(active)) return 'Terminal'
  return active.split('/').pop() ?? 'Terminal'
}

function onFocusIn(): void {
  terminalStore.setFocused(true)
}

function onFocusOut(e: FocusEvent): void {
  if (!root.value?.contains(e.relatedTarget as Node | null)) {
    terminalStore.setFocused(false)
  }
}

onMounted(() => {
  if (terminalStore.tabs.length === 0) terminalStore.addTab(projectBase())
})

onBeforeUnmount(() => terminalStore.setFocused(false))

function newTab(): void {
  terminalStore.addTab(projectBase())
}

function closeTab(key: string): void {
  const removed = terminalStore.removeTab(key)
  if (removed?.ptyId) window.agentkeeper.terminal.kill(removed.ptyId)
}

function restartActive(): void {
  const key = terminalStore.activeKey
  if (!key) return
  const old = terminalStore.restartTab(key)
  if (old) window.agentkeeper.terminal.kill(old)
}

// VS Code-style drag-to-resize
let dragging = false
let startY = 0
let startHeight = 0

function startResize(e: MouseEvent) {
  dragging = true
  startY = e.clientY
  startHeight = terminalStore.height
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', stopResize)
}

function onMouseMove(e: MouseEvent) {
  if (!dragging) return
  const delta = startY - e.clientY
  terminalStore.setHeight(startHeight + delta)
}

function stopResize() {
  dragging = false
  document.removeEventListener('mousemove', onMouseMove)
  document.removeEventListener('mouseup', stopResize)
}
</script>

<template>
  <div
    ref="root"
    class="flex flex-col border-t border-border shrink-0"
    :style="{ height: terminalStore.height + 'px' }"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
    <div
      class="h-1 cursor-ns-resize bg-border hover:bg-primary/30 shrink-0"
      @mousedown="startResize"
    />
    <div class="flex items-center justify-between bg-muted border-b border-border text-xs shrink-0">
      <TooltipProvider :delay-duration="500">
        <div class="flex items-stretch min-w-0 flex-1 overflow-hidden">
          <div
            v-for="tab in terminalStore.tabs"
            :key="tab.key"
            class="group flex items-center gap-1 pl-3 pr-1.5 py-1 border-r border-border min-w-0 shrink basis-36 cursor-pointer transition-colors"
            :class="tab.key === activeKey
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-accent'"
            @click="terminalStore.setActive(tab.key)"
            @dblclick="startRename(tab.key, tab.title)"
            @mousedown.middle.prevent
            @mouseup.middle="closeTab(tab.key)"
          >
            <input
              v-if="editingKey === tab.key"
              :ref="setEditRef"
              v-model="editValue"
              class="font-medium bg-transparent outline-none border-b border-primary min-w-0 flex-1"
              @click.stop
              @keydown.enter.prevent="commitRename"
              @keydown.esc.prevent="cancelRename"
              @blur="commitRename"
            />
            <Tooltip v-else>
              <TooltipTrigger as-child>
                <span class="font-medium truncate min-w-0 flex-1">{{ tab.title }}</span>
              </TooltipTrigger>
              <TooltipContent>{{ tab.title }}</TooltipContent>
            </Tooltip>
            <span
              class="size-3.5 flex items-center justify-center rounded shrink-0 opacity-50 hover:opacity-100 hover:bg-accent"
              title="Close tab (kills shell)"
              @click.stop="closeTab(tab.key)"
            >
              <X class="h-3 w-3" />
            </span>
          </div>
          <button
            class="px-2 flex items-center shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="New terminal tab (⌘T)"
            @click="newTab"
          >
            <Plus class="h-3.5 w-3.5" />
          </button>
        </div>
      </TooltipProvider>
      <div class="flex items-center gap-1 px-3 shrink-0">
        <button
          class="size-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Kill & restart active tab"
          @click="restartActive"
        >
          <RotateCcw class="h-3 w-3" />
        </button>
        <button
          class="size-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Close panel (terminals keep running)"
          @click="terminalStore.toggle()"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
    </div>
    <div class="flex-1 min-h-0 relative">
      <TerminalInstance
        v-for="tab in terminalStore.tabs"
        v-show="tab.key === activeKey"
        :key="`${tab.key}-${tab.epoch}`"
        class="absolute inset-0"
        :tab="tab"
        :active="tab.key === activeKey"
      />
    </div>
  </div>
</template>
