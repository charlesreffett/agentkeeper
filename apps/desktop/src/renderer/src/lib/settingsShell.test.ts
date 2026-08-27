import { describe, expect, it } from 'vitest'
import { isSettingsRoute, shouldCaptureSettingsOrigin } from './settingsShell'

describe('Settings shell selection', () => {
  it('uses the dedicated shell for the Settings root and child routes', () => {
    expect(isSettingsRoute('/settings')).toBe(true)
    expect(isSettingsRoute('/settings/general')).toBe(true)
    expect(isSettingsRoute('/settings/github')).toBe(true)
  })

  it('keeps application navigation for similarly prefixed routes', () => {
    expect(isSettingsRoute('/settings-preview')).toBe(false)
    expect(isSettingsRoute('/sessions')).toBe(false)
  })

  it('captures context only when entering Settings from a resolved app route', () => {
    expect(shouldCaptureSettingsOrigin('/settings/jira', '/jira/board', true)).toBe(true)
    expect(shouldCaptureSettingsOrigin('/settings/github', '/settings/general', true)).toBe(false)
    expect(shouldCaptureSettingsOrigin('/settings/general', '/', false)).toBe(false)
  })
})
