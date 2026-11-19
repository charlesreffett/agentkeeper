import { describe, expect, it } from 'vitest'
import { DEFAULT_THEMES, contrastRatio, deriveTheme } from './theme'
import { THEME_PRESETS, applyPreset, matchPreset } from './themePresets'

describe('theme presets', () => {
  for (const preset of THEME_PRESETS) {
    for (const [variant, seeds] of Object.entries(preset.variants) as [keyof typeof preset.variants, NonNullable<(typeof preset.variants)['light']>][]) {
      it(`${preset.id}/${variant} keeps text legible`, () => {
        const { colors } = deriveTheme({ ...DEFAULT_THEMES[variant], ...seeds }, variant)
        for (const name of ['foreground', 'muted-foreground', 'success', 'warning', 'info', 'destructive', 'highlight'] as const) {
          expect(contrastRatio(colors[name], colors.background), name).toBeGreaterThanOrEqual(4.5)
        }
        expect(contrastRatio(colors.brand, colors['brand-foreground']), 'brand fill').toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(colors.brand, colors.background), 'brand on background').toBeGreaterThanOrEqual(3)
        expect(contrastRatio(colors.link, colors.background), 'link').toBeGreaterThanOrEqual(4.5)
        const { cssVars } = deriveTheme({ ...DEFAULT_THEMES[variant], ...seeds }, variant)
        for (const [name, value] of Object.entries(cssVars).filter(([n]) => n.startsWith('--shiki-token-'))) {
          expect(contrastRatio(value, colors['code-background']), name).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }

  it('recognizes the default theme and detects customization', () => {
    expect(matchPreset(DEFAULT_THEMES.dark, 'dark')).toBe('graphite')
    expect(matchPreset({ ...DEFAULT_THEMES.dark, accent: '#123456' }, 'dark')).toBeNull()
  })

  it('applies seeds without touching fonts', () => {
    const custom = { ...DEFAULT_THEMES.light, fonts: { ui: 'Avenir', code: null } }
    const next = applyPreset(custom, 'forest', 'light')
    expect(next.fonts.ui).toBe('Avenir')
    expect(matchPreset(next, 'light')).toBe('forest')
  })
})
