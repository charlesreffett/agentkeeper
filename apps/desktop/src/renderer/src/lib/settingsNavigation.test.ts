import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Router, RouteLocationNormalizedLoaded } from 'vue-router'
import {
  SETTINGS_FALLBACK,
  SETTINGS_ORIGIN_KEY,
  isSafeSettingsOrigin,
  leaveSettings,
  openSettings,
  readSettingsOrigin,
  replaceSettingsRoute,
} from './settingsNavigation'

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }
}

function route(path: string, fullPath = path): RouteLocationNormalizedLoaded {
  return { path, fullPath } as RouteLocationNormalizedLoaded
}

function router() {
  return {
    push: vi.fn().mockResolvedValue(undefined),
    replace: vi.fn().mockResolvedValue(undefined),
  } as unknown as Router
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', storage())
  vi.stubGlobal('window', { history: { state: {} } })
})

describe('Settings navigation', () => {
  it('accepts only internal, non-Settings return targets', () => {
    expect(isSafeSettingsOrigin({ fullPath: '/github/pr/42?repo=agentkeeper' })).toBe(true)
    expect(isSafeSettingsOrigin({ fullPath: '/settings/github' })).toBe(false)
    expect(isSafeSettingsOrigin({ fullPath: '/plugin/github/settings/configure' })).toBe(false)
    expect(isSafeSettingsOrigin({ fullPath: '//example.com' })).toBe(false)
    expect(isSafeSettingsOrigin({ fullPath: 'https://example.com' })).toBe(false)
  })

  it('captures the exact route context when Settings opens', async () => {
    const instance = router()
    await openSettings(instance, route('/github/pr/42', '/github/pr/42?repo=agentkeeper'), '/settings/github')

    expect(instance.push).toHaveBeenCalledWith({
      path: '/settings/github',
      state: { settingsOrigin: '/github/pr/42?repo=agentkeeper' },
    })
    expect(JSON.parse(sessionStorage.getItem(SETTINGS_ORIGIN_KEY)!)).toEqual({
      fullPath: '/github/pr/42?repo=agentkeeper',
    })
  })

  it('preserves the origin while replacing Settings sections', async () => {
    sessionStorage.setItem(SETTINGS_ORIGIN_KEY, JSON.stringify({ fullPath: '/planner/plan-1' }))
    const instance = router()
    await replaceSettingsRoute(instance, '/settings/appearance')
    expect(instance.replace).toHaveBeenCalledWith({
      path: '/settings/appearance',
      state: { settingsOrigin: '/planner/plan-1' },
    })
  })

  it('restores a persisted origin after a Settings reload', () => {
    sessionStorage.setItem(SETTINGS_ORIGIN_KEY, JSON.stringify({ fullPath: '/sessions/session-1?view=diff' }))
    expect(readSettingsOrigin()).toEqual({ fullPath: '/sessions/session-1?view=diff' })
  })

  it('falls back safely for direct Settings entry', async () => {
    const instance = router()
    await leaveSettings(instance)
    expect(instance.replace).toHaveBeenCalledWith(SETTINGS_FALLBACK)
  })
})
