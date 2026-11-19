import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THEMES,
  THEME_TOKEN_NAMES,
  contrastRatio,
  decodeTheme,
  deriveTheme,
  encodeTheme,
  mixHex,
  normalizeThemeSettings,
  resolveThemeVariant,
} from './theme'

describe('resolveThemeVariant', () => {
  it('follows the OS only for system', () => {
    expect(resolveThemeVariant('system', true)).toBe('dark')
    expect(resolveThemeVariant('system', false)).toBe('light')
    expect(resolveThemeVariant('light', true)).toBe('light')
    expect(resolveThemeVariant('dark', false)).toBe('dark')
  })
})

describe('mixHex', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixHex('#336699', '#ffffff', 0)).toBe('#336699')
    expect(mixHex('#336699', '#ffffff', 1)).toBe('#ffffff')
  })
})

describe('deriveTheme', () => {
  for (const variant of ['light', 'dark'] as const) {
    const theme = deriveTheme(DEFAULT_THEMES[variant], variant)

    it(`emits every token as hex for ${variant}`, () => {
      for (const name of THEME_TOKEN_NAMES) {
        expect(theme.colors[name], name).toMatch(/^#[0-9a-f]{6}$/)
        expect(theme.cssVars[`--${name}`]).toBe(theme.colors[name])
      }
    })

    it(`keeps text tokens legible on the ${variant} background`, () => {
      for (const name of ['foreground', 'muted-foreground', 'success', 'warning', 'info', 'destructive', 'highlight'] as const) {
        expect(contrastRatio(theme.colors[name], theme.colors.background), name).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`keeps fill foregrounds legible for ${variant}`, () => {
      for (const name of ['primary', 'brand', 'success', 'warning', 'info', 'destructive', 'highlight'] as const) {
        expect(contrastRatio(theme.colors[name], theme.colors[`${name}-foreground`]), name).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('moves muted text further from the background as contrast rises', () => {
    const low = deriveTheme({ ...DEFAULT_THEMES.dark, contrast: 0 }, 'dark')
    const high = deriveTheme({ ...DEFAULT_THEMES.dark, contrast: 100 }, 'dark')
    expect(contrastRatio(high.colors['muted-foreground'], high.colors.background))
      .toBeGreaterThan(contrastRatio(low.colors['muted-foreground'], low.colors.background))
  })

  it('honors semantic overrides and falls back diff colors to success/destructive', () => {
    const theme = deriveTheme({ ...DEFAULT_THEMES.light, semantic: { success: '#00aa00' } }, 'light')
    expect(theme.colors.success).toBe('#00aa00')
    expect(theme.colors['diff-added']).toBe('#00aa00')
    expect(theme.colors['diff-removed']).toBe(theme.colors.destructive)
  })

  it('uses default font stacks when fonts are unset', () => {
    const theme = deriveTheme(DEFAULT_THEMES.light, 'light')
    expect(theme.cssVars['--font-sans']).toContain('Inter')
    expect(theme.cssVars['--font-mono']).toContain('monospace')
  })
})

describe('normalizeThemeSettings', () => {
  it('fills defaults for missing or malformed input', () => {
    expect(normalizeThemeSettings(undefined)).toEqual(DEFAULT_THEMES)
    expect(normalizeThemeSettings({ dark: { accent: 'red', contrast: 'x' } }).dark).toEqual(DEFAULT_THEMES.dark)
  })

  it('normalizes hex case/shorthand, clamps contrast, and sanitizes fonts', () => {
    const out = normalizeThemeSettings({
      light: { accent: '#ABC', contrast: 250, fonts: { ui: 'Inter; } body { x', code: '' }, semantic: { info: '#123456', bogus: '#fff' } },
    }).light
    expect(out.accent).toBe('#aabbcc')
    expect(out.contrast).toBe(100)
    expect(out.fonts).toEqual({ ui: 'Inter  body  x', code: null })
    expect(out.semantic).toEqual({ info: '#123456' })
  })
})

describe('encodeTheme / decodeTheme', () => {
  it('round-trips', () => {
    const config = { ...DEFAULT_THEMES.dark, accent: '#ff79c6' }
    expect(decodeTheme(encodeTheme(config, 'dark'))).toEqual({ variant: 'dark', theme: config })
  })

  it('rejects foreign or malformed strings', () => {
    expect(decodeTheme('codex-theme-v1:{}')).toBeNull()
    expect(decodeTheme('agentkeeper-theme-v1:{nope')).toBeNull()
  })
})
