import { describe, expect, it } from 'vitest'
import { resolveThemePreference } from './layout'

describe('theme preference', () => {
  it('resolves system, light, and dark choices', () => {
    expect(resolveThemePreference('system', true)).toBe('dark')
    expect(resolveThemePreference('system', false)).toBe('light')
    expect(resolveThemePreference('light', true)).toBe('light')
    expect(resolveThemePreference('dark', false)).toBe('dark')
  })
})
