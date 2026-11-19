import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { AppSettings } from '@shared/ipc-contract'
import {
  CODE_FONT_SIZE,
  DEFAULT_THEMES,
  UI_FONT_SIZE,
  clampFontSize,
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
import { applyAppearanceClasses, applyThemeToDocument } from '@/lib/theme'

const OS_HIGH_CONTRAST_FLOOR = 85
const isMacOS = navigator.userAgent.includes('Macintosh')

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
  const uiFontSize = ref<number>(UI_FONT_SIZE.default)
  const codeFontSize = ref<number>(CODE_FONT_SIZE.default)
  const resolved = ref<ResolvedTheme>(deriveTheme(DEFAULT_THEMES.dark, 'dark'))
  const resolvedTheme = computed(() => resolved.value.variant)
  /** Hex values for consumers that can't read CSS variables (xterm, SVG attributes). */
  const colors = computed(() => resolved.value.colors)
  const cssVars = computed(() => resolved.value.cssVars)
  const translucentSidebar = ref(false)
  const pointerCursors = ref(true)
  const osHighContrast = ref(window.matchMedia('(prefers-contrast: more)').matches)
  let systemThemeQuery: MediaQueryList | null = null

  function apply() {
    const variant = resolveThemeVariant(theme.value, window.matchMedia('(prefers-color-scheme: dark)').matches)
    const config = themes.value[variant]
    // The OS accessibility setting raises the floor without rewriting the user's saved contrast.
    const contrast = osHighContrast.value ? Math.max(config.contrast, OS_HIGH_CONTRAST_FLOOR) : config.contrast
    const derived = deriveTheme({ ...config, contrast }, variant)
    derived.cssVars['--code-font-size'] = `${codeFontSize.value}px`
    resolved.value = derived
    applyThemeToDocument(derived)
    applyAppearanceClasses({ translucentSidebar: translucentSidebar.value && isMacOS, pointerCursors: pointerCursors.value })
  }

  function onSystemThemeChange() {
    if (theme.value === 'system') apply()
  }

  function watchSystemTheme() {
    if (systemThemeQuery) return
    systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemThemeQuery.addEventListener('change', onSystemThemeChange)
    window.matchMedia('(prefers-contrast: more)').addEventListener('change', e => {
      osHighContrast.value = e.matches
      apply()
    })
  }

  function initTheme(settings: Pick<AppSettings, 'theme' | 'themes' | 'uiFontSize' | 'codeFontSize' | 'translucentSidebar' | 'pointerCursors'>) {
    watchSystemTheme()
    theme.value = settings.theme ?? 'dark'
    themes.value = normalizeThemeSettings(settings.themes)
    uiFontSize.value = clampFontSize(settings.uiFontSize, UI_FONT_SIZE)
    codeFontSize.value = clampFontSize(settings.codeFontSize, CODE_FONT_SIZE)
    translucentSidebar.value = settings.translucentSidebar === true
    pointerCursors.value = settings.pointerCursors !== false
    apply()
  }

  async function setTheme(pref: ThemePreference) {
    watchSystemTheme()
    theme.value = pref
    apply()
    await window.agentkeeper.settings.set({ theme: pref })
  }

  // Color pickers emit on every drag frame; apply live, persist once input settles.
  const persist = useDebounceFn((partial: Partial<AppSettings>) => window.agentkeeper.settings.set(partial), 300)

  function setThemeConfig(variant: ThemeVariant, config: ThemeConfig) {
    themes.value = { ...themes.value, [variant]: normalizeThemeConfig(config, DEFAULT_THEMES[variant]) }
    apply()
    void persist({ themes: JSON.parse(JSON.stringify(themes.value)) as ThemeSettings })
  }

  window.agentkeeper.settings.onUiFontSizeChanged(size => { uiFontSize.value = size })

  async function setFontSizes(sizes: { uiFontSize?: number; codeFontSize?: number }) {
    const partial: Partial<AppSettings> = {}
    if (sizes.uiFontSize !== undefined) partial.uiFontSize = uiFontSize.value = clampFontSize(sizes.uiFontSize, UI_FONT_SIZE)
    if (sizes.codeFontSize !== undefined) partial.codeFontSize = codeFontSize.value = clampFontSize(sizes.codeFontSize, CODE_FONT_SIZE)
    apply()
    await window.agentkeeper.settings.set(partial)
  }

  async function setWindowOptions(options: Partial<Pick<AppSettings, 'translucentSidebar' | 'pointerCursors'>>) {
    if (options.translucentSidebar !== undefined) translucentSidebar.value = options.translucentSidebar
    if (options.pointerCursors !== undefined) pointerCursors.value = options.pointerCursors
    apply()
    await window.agentkeeper.settings.set(options)
  }

  return { rightPanelOpen, toggleRightPanel, hoveredEdgeId, setHoveredEdge, theme, themes, uiFontSize, codeFontSize, resolvedTheme, colors, cssVars, translucentSidebar, pointerCursors, osHighContrast, isMacOS, initTheme, setTheme, setThemeConfig, setFontSizes, setWindowOptions }
})
