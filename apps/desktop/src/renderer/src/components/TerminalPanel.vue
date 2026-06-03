<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { X, RotateCcw } from 'lucide-vue-next'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalStore } from '@/stores/terminalStore'
import { useProjectsQuery } from '@/composables/useProjectsQuery'

const terminalStore = useTerminalStore()
const { focusedProject } = useProjectsQuery()

const terminalContainer = ref<HTMLDivElement | null>(null)

let xterm: Terminal | null = null
let fitAddon: FitAddon | null = null
let offData: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

function wireListeners(id: string): void {
  offData = window.agentkeeper.terminal.onData((termId, data) => {
    if (termId === id) xterm?.write(data)
  })
  xterm!.onData(data => {
    window.agentkeeper.terminal.sendInput(id, data)
  })
  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit()
    if (xterm && id) {
      window.agentkeeper.terminal.resize(id, xterm.cols, xterm.rows)
    }
  })
  if (terminalContainer.value) {
    resizeObserver.observe(terminalContainer.value)
  }
}

onMounted(async () => {
  xterm = new Terminal({
    theme: { background: '#18181b' },
    fontSize: 13,
    fontFamily: 'monospace',
    cursorBlink: true,
  })

  fitAddon = new FitAddon()
  xterm.loadAddon(fitAddon)

  if (terminalContainer.value) {
    xterm.open(terminalContainer.value)
    fitAddon.fit()
  }

  const existingId = terminalStore.terminalId
  if (existingId) {
    const buffered = await window.agentkeeper.terminal.attach(existingId)
    if (buffered) xterm.write(buffered)
    wireListeners(existingId)
  } else {
    const cwd = focusedProject.value?.path ?? '/'
    const id = await window.agentkeeper.terminal.create(cwd)
    terminalStore.terminalId = id
    wireListeners(id)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  offData?.()
  xterm?.dispose()
  // PTY intentionally left running; terminalStore.terminalId preserved for reattach
})

async function killAndRestart(): Promise<void> {
  const id = terminalStore.terminalId
  if (id) {
    offData?.()
    offData = null
    resizeObserver?.disconnect()
    resizeObserver = null
    await window.agentkeeper.terminal.kill(id)
    terminalStore.terminalId = null
  }

  xterm?.clear()

  const cwd = focusedProject.value?.path ?? '/'
  const newId = await window.agentkeeper.terminal.create(cwd)
  terminalStore.terminalId = newId

  await nextTick()
  if (terminalContainer.value && xterm) {
    fitAddon?.fit()
  }
  wireListeners(newId)
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
  // drag handle is at top edge; dragging up increases height
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
  <div class="flex flex-col border-t border-border shrink-0" :style="{ height: terminalStore.height + 'px' }">
    <div
      class="h-1 cursor-ns-resize bg-border hover:bg-primary/30 shrink-0"
      @mousedown="startResize"
    />
    <div class="flex items-center justify-between px-3 py-1 bg-muted border-b border-border text-xs shrink-0">
      <span class="font-medium">Terminal</span>
      <div class="flex items-center gap-1">
        <button
          class="size-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Kill & restart"
          @click="killAndRestart"
        >
          <RotateCcw class="h-3 w-3" />
        </button>
        <button
          class="size-4 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Close (terminal keeps running)"
          @click="terminalStore.toggle()"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
    </div>
    <div ref="terminalContainer" class="flex-1 min-h-0 bg-zinc-900 p-1 overflow-hidden" />
  </div>
</template>
