import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'

export const SETTINGS_FALLBACK = '/sessions'
export const SETTINGS_ORIGIN_KEY = 'agentkeeper:settings-origin'

export interface SettingsOrigin {
  fullPath: string
}

export function isSafeSettingsOrigin(value: unknown): value is SettingsOrigin {
  if (!value || typeof value !== 'object') return false
  const fullPath = (value as SettingsOrigin).fullPath
  return typeof fullPath === 'string'
    && fullPath.startsWith('/')
    && !fullPath.startsWith('//')
    && !/^\/settings(?:\/|\?|#|$)/.test(fullPath)
}

export function readSettingsOrigin(): SettingsOrigin | null {
  const fromHistory = window.history.state?.settingsOrigin
  if (typeof fromHistory === 'string') {
    const origin = { fullPath: fromHistory }
    if (isSafeSettingsOrigin(origin)) return origin
  }
  if (isSafeSettingsOrigin(fromHistory)) return fromHistory
  try {
    const stored = JSON.parse(sessionStorage.getItem(SETTINGS_ORIGIN_KEY) ?? 'null')
    return isSafeSettingsOrigin(stored) ? stored : null
  } catch {
    return null
  }
}

export function persistSettingsOrigin(origin: SettingsOrigin): void {
  try {
    sessionStorage.setItem(SETTINGS_ORIGIN_KEY, JSON.stringify(origin))
  } catch {
    // Navigation state remains available when session storage is unavailable.
  }
}

export function captureSettingsOrigin(fullPath: string): SettingsOrigin | null {
  const origin = { fullPath }
  if (!isSafeSettingsOrigin(origin)) return null
  persistSettingsOrigin(origin)
  return origin
}

export function openSettings(
  router: Router,
  route: RouteLocationNormalizedLoaded,
  destination = '/settings/general',
): Promise<unknown> {
  const existing = readSettingsOrigin()
  const origin = /^\/settings(?:\/|$)/.test(route.path) ? existing : captureSettingsOrigin(route.fullPath)
  return router.push({ path: destination, state: origin ? { settingsOrigin: origin.fullPath } : undefined })
}

export function replaceSettingsRoute(router: Router, destination: string): Promise<unknown> {
  const origin = readSettingsOrigin()
  return router.replace({ path: destination, state: origin ? { settingsOrigin: origin.fullPath } : undefined })
}

export async function leaveSettings(router: Router): Promise<unknown> {
  const origin = readSettingsOrigin()
  const result = await router.replace(origin?.fullPath ?? SETTINGS_FALLBACK)
  try {
    sessionStorage.removeItem(SETTINGS_ORIGIN_KEY)
  } catch {
    // A deterministic fallback still works without storage access.
  }
  return result
}
