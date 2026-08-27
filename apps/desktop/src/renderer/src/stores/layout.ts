import { defineStore } from 'pinia'
import { ref } from 'vue'

export type ThemePreference = 'system' | 'light' | 'dark'

export function resolveThemePreference(theme: ThemePreference, prefersDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
}

export const useLayoutStore = defineStore('layout', () => {
  const rightPanelOpen = ref(false)
  function toggleRightPanel() {
    rightPanelOpen.value = !rightPanelOpen.value
  }

  // Id of the agency-canvas edge currently hovered, so a connected node can
  // sync its bridge stub (color + width) with the edge's hover styling. The
  // bridge lives on the node (above the standoff ring) and can't otherwise
  // observe the edge component's local hover state.
  const hoveredEdgeId = ref<string | null>(null)
  function setHoveredEdge(id: string | null) {
    hoveredEdgeId.value = id
  }

  const theme = ref<ThemePreference>('dark')
  const resolvedTheme = ref<'light' | 'dark'>('dark')
  let systemThemeQuery: MediaQueryList | null = null

  function resolveTheme(t: ThemePreference): 'light' | 'dark' {
    return resolveThemePreference(t, window.matchMedia('(prefers-color-scheme: dark)').matches)
  }

  function applyTheme(t: ThemePreference) {
    resolvedTheme.value = resolveTheme(t)
    document.documentElement.classList.toggle('dark', resolvedTheme.value === 'dark')
  }

  function onSystemThemeChange() {
    if (theme.value === 'system') applyTheme('system')
  }

  function watchSystemTheme() {
    if (systemThemeQuery) return
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeQuery.addEventListener('change', onSystemThemeChange)
  }

  // Called once on app startup — applies without writing back to disk.
  function initTheme(t: ThemePreference) {
    watchSystemTheme()
    theme.value = t
    applyTheme(t)
  }

  async function setTheme(t: ThemePreference) {
    watchSystemTheme()
    theme.value = t
    applyTheme(t)
    await window.agentkeeper.settings.set({ theme: t })
  }

  return { rightPanelOpen, toggleRightPanel, hoveredEdgeId, setHoveredEdge, theme, resolvedTheme, initTheme, setTheme }
})
