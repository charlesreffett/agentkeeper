import type { ResolvedTheme } from '@shared/theme'

const CACHE_KEY = 'agentkeeper.resolvedTheme'

export function applyThemeToDocument(theme: Pick<ResolvedTheme, 'variant' | 'cssVars'>): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.cssVars)) root.style.setProperty(name, value)
  root.classList.toggle('dark', theme.variant === 'dark')
  root.style.colorScheme = theme.variant
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ variant: theme.variant, cssVars: theme.cssVars }))
  } catch {
    // Storage full or disabled — only costs a first-paint flash next launch.
  }
}

export function applyAppearanceClasses(options: { translucentSidebar: boolean; pointerCursors: boolean }): void {
  const root = document.documentElement
  root.classList.toggle('translucent-sidebar', options.translucentSidebar)
  root.classList.toggle('no-pointer-cursors', !options.pointerCursors)
}

/** Settings arrive over async IPC; replaying last launch's tokens avoids an unstyled first paint. */
export function applyCachedTheme(): boolean {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Pick<ResolvedTheme, 'variant' | 'cssVars'> | null
    if (!cached?.cssVars || (cached.variant !== 'light' && cached.variant !== 'dark')) return false
    applyThemeToDocument(cached)
    return true
  } catch {
    return false
  }
}
