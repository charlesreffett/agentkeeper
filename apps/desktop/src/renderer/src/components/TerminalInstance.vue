<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import 'xterm/css/xterm.css'
import { useTerminalStore } from '@/stores/terminalStore'
import { useProjectsQuery } from '@/composables/useProjectsQuery'
import type { TerminalTab } from '@/stores/terminalStore'

const props = defineProps<{ tab: TerminalTab; active: boolean }>()

const terminalStore = useTerminalStore()
const { focusedProject } = useProjectsQuery()

const container = ref<HTMLDivElement | null>(null)

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
    if (xterm) window.agentkeeper.terminal.resize(id, xterm.cols, xterm.rows)
  })
  if (container.value) resizeObserver.observe(container.value)
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

  if (container.value) {
    xterm.open(container.value)
    fitAddon.fit()
  }

  if (props.tab.ptyId) {
    const buffered = await window.agentkeeper.terminal.attach(props.tab.ptyId)
    if (buffered) xterm.write(buffered)
    wireListeners(props.tab.ptyId)
  } else {
    const cwd = focusedProject.value?.path ?? '/'
    const id = await window.agentkeeper.terminal.create(cwd)
    terminalStore.setPtyId(props.tab.key, id)
    wireListeners(id)
  }

  if (props.active) {
    await nextTick()
    fitAddon?.fit()
    xterm.focus()
  }
})

watch(() => props.active, async isActive => {
  if (isActive) {
    await nextTick()
    fitAddon?.fit()
    xterm?.focus()
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  offData?.()
  xterm?.dispose()
  // PTY intentionally left running; reattached via tab.ptyId on remount.
})
</script>

<template>
  <div ref="container" class="h-full w-full bg-zinc-900 p-1 overflow-hidden" />
</template>
