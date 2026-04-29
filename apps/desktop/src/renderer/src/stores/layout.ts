import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLayoutStore = defineStore('layout', () => {
  const rightPanelOpen = ref(false)
  function toggleRightPanel() {
    rightPanelOpen.value = !rightPanelOpen.value
  }

  const theme = ref<'light' | 'dark'>('dark')

  function _applyClass(t: 'light' | 'dark') {
    document.documentElement.classList.toggle('dark', t === 'dark')
  }

  // Called once on app startup — applies without writing back to disk.
  function initTheme(t: 'light' | 'dark') {
    theme.value = t
    _applyClass(t)
  }

  async function setTheme(t: 'light' | 'dark') {
    theme.value = t
    _applyClass(t)
    await window.agentkeeper.settings.set({ theme: t })
  }

  function toggleTheme() {
    return setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  return { rightPanelOpen, toggleRightPanel, theme, initTheme, setTheme, toggleTheme }
})
