import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROLE_EFFORT_VALUES,
  type AppSettings,
} from '../shared/ipc-contract'
import { CODE_FONT_SIZE, DEFAULT_THEMES, UI_FONT_SIZE, clampFontSize, normalizeThemeSettings } from '../shared/theme'

const DEFAULTS: AppSettings = {
  pluginDeveloperMode: false,
  defaultModel: 'default',
  defaultEffort: 'medium',
  defaultUseWorktree: false,
  enterToSend: false,
  sendModifier: 'auto' as const,
  sessionExpiryEnabled: false,
  sessionExpiryDays: 14,
  theme: 'dark',
  themes: DEFAULT_THEMES,
  uiFontSize: UI_FONT_SIZE.default,
  codeFontSize: CODE_FONT_SIZE.default,
  translucentSidebar: false,
  pointerCursors: true,
  notifications: 'all',
  notificationSound: 'chime',
  mcpServers: [],
  harnessId: 'claude-code',
  harnessBins: {},
  harnessConfig: {},
  customModels: {},
  mobileServer: { enabled: false, port: 57372, secretKey: '' },
  gitSwitchWithoutSoftReject: false,
  lastUsedModels: {},
}

const SEND_MODIFIER_VALUES: AppSettings['sendModifier'][] = ['auto', 'meta', 'ctrl', 'alt', 'shift']
const THEME_VALUES: AppSettings['theme'][] = ['system', 'light', 'dark']
const NOTIFICATIONS_VALUES: AppSettings['notifications'][] = ['all', 'notification-only', 'sound-only', 'toast', 'disabled']
const NOTIFICATION_SOUND_VALUES: AppSettings['notificationSound'][] = ['chime', 'bell', 'ping', 'ding', 'pulse']

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function read(): AppSettings {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    const merged = { ...DEFAULTS, ...parsed }
    // Developer mode is enabled only by the dedicated, native-confirmed setter.
    // Missing or malformed persisted values must never become truthy by coercion.
    merged.pluginDeveloperMode = parsed.pluginDeveloperMode === true
    // Guard against stale / malformed data on disk (e.g. an older
    // settings.json written before `defaultEffort` existed, or a manual
    // edit). Fall back to the default for any invalid effort value.
    if (!ROLE_EFFORT_VALUES.includes(merged.defaultEffort)) {
      merged.defaultEffort = DEFAULTS.defaultEffort
    }
    if (!SEND_MODIFIER_VALUES.includes(merged.sendModifier)) {
      merged.sendModifier = DEFAULTS.sendModifier
    }
    if (!THEME_VALUES.includes(merged.theme)) {
      merged.theme = DEFAULTS.theme
    }
    merged.themes = normalizeThemeSettings(parsed.themes)
    merged.uiFontSize = clampFontSize(merged.uiFontSize, UI_FONT_SIZE)
    merged.codeFontSize = clampFontSize(merged.codeFontSize, CODE_FONT_SIZE)
    merged.translucentSidebar = merged.translucentSidebar === true
    merged.pointerCursors = merged.pointerCursors !== false
    if (!NOTIFICATIONS_VALUES.includes(merged.notifications)) {
      merged.notifications = DEFAULTS.notifications
    }
    if (!NOTIFICATION_SOUND_VALUES.includes(merged.notificationSound)) {
      merged.notificationSound = DEFAULTS.notificationSound
    }
    if (!Array.isArray(merged.mcpServers)) {
      merged.mcpServers = []
    }
    return merged
  } catch {
    return { ...DEFAULTS }
  }
}

// Untouched theme slots stay off disk so a future change to the default
// theme reaches users who never customized it.
function themesForDisk(themes: AppSettings['themes']): Partial<AppSettings['themes']> {
  const out: Partial<AppSettings['themes']> = {}
  for (const variant of ['light', 'dark'] as const) {
    if (JSON.stringify(themes[variant]) !== JSON.stringify(DEFAULT_THEMES[variant])) out[variant] = themes[variant]
  }
  return out
}

function write(data: AppSettings): void {
  const f = filePath()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify({ ...data, themes: themesForDisk(data.themes) }, null, 2))
}

export const settingsStore = {
  get(): AppSettings {
    return read()
  },
  set(partial: Partial<AppSettings>): AppSettings {
    const next = { ...read(), ...partial }
    if (partial.themes) next.themes = normalizeThemeSettings(partial.themes)
    next.uiFontSize = clampFontSize(next.uiFontSize, UI_FONT_SIZE)
    next.codeFontSize = clampFontSize(next.codeFontSize, CODE_FONT_SIZE)
    write(next)
    return next
  },
  setPluginDeveloperMode(enabled: boolean): AppSettings {
    return this.set({ pluginDeveloperMode: enabled === true })
  },
}
