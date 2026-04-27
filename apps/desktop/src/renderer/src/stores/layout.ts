import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLayoutStore = defineStore('layout', () => {
  const rightPanelOpen = ref(false)
  function toggleRightPanel() {
    rightPanelOpen.value = !rightPanelOpen.value
  }
  return { rightPanelOpen, toggleRightPanel }
})
