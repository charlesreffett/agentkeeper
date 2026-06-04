import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useTerminalStore = defineStore('terminal', () => {
  const isOpen = ref(false)
  const height = ref(240)
  const terminalId = ref<string | null>(null)

  function toggle() { isOpen.value = !isOpen.value }
  function setHeight(h: number) { height.value = Math.max(100, Math.min(h, 600)) }

  return { isOpen, height, terminalId, toggle, setHeight }
})
