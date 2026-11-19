import { BrowserWindow, nativeTheme } from 'electron'
import type { AppSettings } from '../shared/ipc-contract'
import { resolveThemeVariant } from '../shared/theme'
import { settingsStore } from './settings'

type AppearanceSettings = Pick<AppSettings, 'theme' | 'themes' | 'translucentSidebar'>

export interface WindowAppearance {
  backgroundColor: string
  vibrancy: 'sidebar' | null
}

export function windowAppearance(settings: AppearanceSettings, platform: NodeJS.Platform, systemDark: boolean): WindowAppearance {
  // Vibrancy only shows through where the window itself is transparent.
  if (platform === 'darwin' && settings.translucentSidebar) return { backgroundColor: '#00000000', vibrancy: 'sidebar' }
  const variant = resolveThemeVariant(settings.theme, systemDark)
  return { backgroundColor: settings.themes[variant].background, vibrancy: null }
}

// Follow the app's theme rather than the OS so the vibrancy material, native
// menus, and dialogs match the light/dark mode the user picked.
function syncThemeSource(settings: AppearanceSettings): void {
  nativeTheme.themeSource = settings.theme
}

export function initialWindowAppearance(): WindowAppearance {
  const settings = settingsStore.get()
  syncThemeSource(settings)
  return windowAppearance(settings, process.platform, nativeTheme.shouldUseDarkColors)
}

export function applyWindowAppearance(settings: AppearanceSettings = settingsStore.get()): void {
  syncThemeSource(settings)
  const next = windowAppearance(settings, process.platform, nativeTheme.shouldUseDarkColors)
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(next.backgroundColor)
    if (process.platform === 'darwin') win.setVibrancy(next.vibrancy)
  }
}
