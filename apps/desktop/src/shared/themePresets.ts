import { DEFAULT_THEMES, type ThemeConfig, type ThemeVariant } from './theme'

export interface ThemePreset {
  id: string
  label: string
  /** Seeds only — fonts and semantic overrides stay whatever the user has. */
  variants: Partial<Record<ThemeVariant, Pick<ThemeConfig, 'accent' | 'background' | 'foreground' | 'contrast'>>>
}

const seeds = (c: ThemeConfig) => ({ accent: c.accent, background: c.background, foreground: c.foreground, contrast: c.contrast })

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'graphite',
    label: 'Graphite',
    variants: { light: seeds(DEFAULT_THEMES.light), dark: seeds(DEFAULT_THEMES.dark) },
  },
  {
    id: 'paper',
    label: 'Paper',
    variants: {
      light: { accent: '#a24a24', background: '#f3eee4', foreground: '#2b2620', contrast: 55 },
      dark: { accent: '#e39a6f', background: '#221e1a', foreground: '#ede6da', contrast: 50 },
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    variants: {
      light: { accent: '#2c7a51', background: '#f1f4f0', foreground: '#1b2820', contrast: 50 },
      dark: { accent: '#6ccf98', background: '#131b17', foreground: '#e2ebe5', contrast: 50 },
    },
  },
  {
    id: 'dusk',
    label: 'Dusk',
    variants: {
      light: { accent: '#7646c4', background: '#f5f3f8', foreground: '#231d2e', contrast: 50 },
      dark: { accent: '#c39cf2', background: '#1c1925', foreground: '#ebe6f3', contrast: 55 },
    },
  },
  {
    id: 'high-contrast',
    label: 'High contrast',
    variants: {
      light: { accent: '#0040c8', background: '#ffffff', foreground: '#000000', contrast: 100 },
      dark: { accent: '#79b0ff', background: '#000000', foreground: '#ffffff', contrast: 100 },
    },
  },
]

export function presetsFor(variant: ThemeVariant): ThemePreset[] {
  return THEME_PRESETS.filter(p => p.variants[variant])
}

/** Id of the preset whose seeds exactly match, or null when the theme has been customized. */
export function matchPreset(config: ThemeConfig, variant: ThemeVariant): string | null {
  const hit = THEME_PRESETS.find(p => {
    const v = p.variants[variant]
    return v && v.accent === config.accent && v.background === config.background
      && v.foreground === config.foreground && v.contrast === config.contrast
  })
  return hit?.id ?? null
}

export function applyPreset(config: ThemeConfig, presetId: string, variant: ThemeVariant): ThemeConfig {
  const seedsFor = THEME_PRESETS.find(p => p.id === presetId)?.variants[variant]
  return seedsFor ? { ...config, ...seedsFor } : config
}
