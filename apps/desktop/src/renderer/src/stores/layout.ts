import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  DEFAULT_THEMES,
  deriveTheme,
  normalizeThemeConfig,
  normalizeThemeSettings,
  resolveThemeVariant,
  type ResolvedTheme,
  type ThemeConfig,
  type ThemePreference,
  type ThemeSettings,
  type ThemeVariant,
} from '@shared/theme'
import { applyThemeToDocument } from '@/lib/theme'

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
  const themes = ref<ThemeSettings>(structuredClone(DEFAULT_THEMES))
  const resolved = ref<ResolvedTheme>(deriveTheme(DEFAULT_THEMES.dark, 'dark'))
  const resolvedTheme = computed(() => resolved.value.variant)
  /** Hex values for consumers that can't read CSS variables (xterm, SVG attributes). */
  const colors = computed(() => resolved.value.colors)
  let systemThemeQuery: MediaQueryList | null = null

  function apply() {
    const variant = resolveThemeVariant(theme.value, window.matchMedia('(prefers-color-scheme: dark)').matches)
    resolved.value = deriveTheme(themes.value[variant], variant)
    applyThemeToDocument(resolved.value)
  }

  function onSystemThemeChange() {
    if (theme.value === 'system') apply()
  }

  function watchSystemTheme() {
    if (systemThemeQuery) return
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeQuery.addEventListener('change', onSystemThemeChange)
  }

  function initTheme(pref: ThemePreference, configs: ThemeSettings | undefined) {
    watchSystemTheme()
    theme.value = pref
    themes.value = normalizeThemeSettings(configs)
    apply()
  }

  async function setTheme(pref: ThemePreference) {
    watchSystemTheme()
    theme.value = pref
    apply()
    await window.agentkeeper.settings.set({ theme: pref })
  }

  async function setThemeConfig(variant: ThemeVariant, config: ThemeConfig) {
    themes.value = { ...themes.value, [variant]: normalizeThemeConfig(config, DEFAULT_THEMES[variant]) }
    apply()
    await window.agentkeeper.settings.set({ themes: JSON.parse(JSON.stringify(themes.value)) as ThemeSettings })
  }

  return { rightPanelOpen, toggleRightPanel, hoveredEdgeId, setHoveredEdge, theme, themes, resolvedTheme, colors, initTheme, setTheme, setThemeConfig }
})
