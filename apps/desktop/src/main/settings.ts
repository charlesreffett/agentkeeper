import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  ROLE_EFFORT_VALUES,
  type AppSettings,
} from '../shared/ipc-contract'

const DEFAULTS: AppSettings = {
  defaultModel: 'default',
  defaultEffort: 'medium',
  defaultUseWorktree: false,
  enterToSend: false,
  sendModifier: 'auto' as const,
  sessionExpiryDays: 14,
  theme: 'dark',
  notifications: 'all',
  notificationSound: 'chime',
  mcpServers: [],
  harnessId: 'claude-code',
  mobileServer: { enabled: false, port: 57372, secretKey: '' },
  gitSwitchWithoutSoftReject: false,
}

const SEND_MODIFIER_VALUES: AppSettings['sendModifier'][] = ['auto', 'meta', 'ctrl', 'alt', 'shift']
const THEME_VALUES: AppSettings['theme'][] = ['light', 'dark']
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

function write(data: AppSettings): void {
  const f = filePath()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(data, null, 2))
}

export const settingsStore = {
  get(): AppSettings {
    return read()
  },
  set(partial: Partial<AppSettings>): AppSettings {
    const next = { ...read(), ...partial }
    write(next)
    return next
  },
}
