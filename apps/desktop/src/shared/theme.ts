export type ThemeVariant = 'light' | 'dark'
export type ThemePreference = 'system' | ThemeVariant

export const SEMANTIC_COLOR_KEYS = ['success', 'warning', 'info', 'destructive', 'highlight', 'diffAdded', 'diffRemoved'] as const
export type SemanticColorKey = (typeof SEMANTIC_COLOR_KEYS)[number]

export interface ThemeFonts {
  /** CSS font-family list; null = built-in default. */
  ui: string | null
  code: string | null
}

export interface ThemeConfig {
  accent: string
  background: string
  foreground: string
  /** 0–100. Scales how far derived surfaces, borders, and muted text move away from the background. */
  contrast: number
  fonts: ThemeFonts
  /** Optional per-theme overrides; anything omitted is derived from the variant. */
  semantic: Partial<Record<SemanticColorKey, string>>
}

export interface ThemeSettings {
  light: ThemeConfig
  dark: ThemeConfig
}

export const DEFAULT_THEMES: ThemeSettings = {
  light: {
    accent: '#2f64d6',
    background: '#f7f7f7',
    foreground: '#211e1c',
    contrast: 50,
    fonts: { ui: null, code: null },
    semantic: {},
  },
  dark: {
    accent: '#6d9bf1',
    background: '#17202a',
    foreground: '#fafafa',
    contrast: 50,
    fonts: { ui: null, code: null },
    semantic: {},
  },
}

export const DEFAULT_UI_FONT = "InterVariable, Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
export const DEFAULT_CODE_FONT = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

export function resolveThemeVariant(pref: ThemePreference, prefersDark: boolean): ThemeVariant {
  return pref === 'system' ? (prefersDark ? 'dark' : 'light') : pref
}

// ---------------------------------------------------------------------------
// Color math. Mixing happens in OKLab so steps between background and
// foreground look perceptually even regardless of the seed hues.

type Lab = [number, number, number]

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim())
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255) as [number, number, number]
}

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const fromLinear = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function rgbToLab([r, g, b]: [number, number, number]): Lab {
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function labToLinearRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

function inGamut(rgb: [number, number, number]): boolean {
  return rgb.every(c => c >= -1e-4 && c <= 1 + 1e-4)
}

/** Reduces chroma until the color fits sRGB, so saturated semantic hues keep their lightness. */
function labToHex(lab: Lab): string {
  let [L, a, b] = lab
  L = Math.min(1, Math.max(0, L))
  let rgb = labToLinearRgb([L, a, b])
  for (let i = 0; i < 24 && !inGamut(rgb); i++) {
    a *= 0.9
    b *= 0.9
    rgb = labToLinearRgb([L, a, b])
  }
  return '#' + rgb
    .map(c => Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, c))))) * 255))
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
}

const hexToLab = (hex: string): Lab => rgbToLab(hexToRgb(hex))

function mixLab(from: Lab, to: Lab, t: number): Lab {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]
}

function oklch(L: number, C: number, H: number): Lab {
  const rad = (H * Math.PI) / 180
  return [L, C * Math.cos(rad), C * Math.sin(rad)]
}

export function mixHex(from: string, to: string, t: number): string {
  return labToHex(mixLab(hexToLab(from), hexToLab(to), t))
}

/** WCAG relative luminance, used to pick legible text on solid fills. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function onColor(fill: string, light: string, dark: string): string {
  return contrastRatio(fill, light) >= contrastRatio(fill, dark) ? light : dark
}

// ---------------------------------------------------------------------------
// Token derivation

export const THEME_TOKEN_NAMES = [
  'background', 'foreground',
  'card', 'card-foreground',
  'popover', 'popover-foreground', 'popover-border',
  'primary', 'primary-foreground',
  'secondary', 'secondary-foreground',
  'muted', 'muted-foreground',
  'accent', 'accent-foreground',
  'brand', 'brand-foreground',
  'destructive', 'destructive-foreground',
  'success', 'success-foreground',
  'warning', 'warning-foreground',
  'info', 'info-foreground',
  'highlight', 'highlight-foreground',
  'diff-added', 'diff-removed',
  'border', 'input', 'ring',
  'code-background', 'code-foreground',
  'sidebar-background', 'sidebar-foreground',
  'sidebar-primary', 'sidebar-primary-foreground',
  'sidebar-accent', 'sidebar-accent-foreground',
  'sidebar-border', 'sidebar-ring',
] as const
export type ThemeTokenName = (typeof THEME_TOKEN_NAMES)[number]

export interface ResolvedTheme {
  variant: ThemeVariant
  /** Every color token as a hex string, for consumers that can't read CSS variables (xterm, SVG attributes). */
  colors: Record<ThemeTokenName, string>
  /** Full set of CSS custom properties to apply on the document root. */
  cssVars: Record<string, string>
}

// Lightness/chroma per variant chosen so each hue reads as text on the
// background and as a solid fill behind white/near-black text.
const SEMANTIC_DEFAULTS: Record<ThemeVariant, Record<'success' | 'warning' | 'info' | 'destructive' | 'highlight', Lab>> = {
  light: {
    success: oklch(0.52, 0.14, 152),
    warning: oklch(0.55, 0.14, 62),
    info: oklch(0.55, 0.17, 255),
    destructive: oklch(0.55, 0.2, 27),
    highlight: oklch(0.54, 0.2, 300),
  },
  dark: {
    success: oklch(0.74, 0.16, 155),
    warning: oklch(0.8, 0.15, 75),
    info: oklch(0.72, 0.13, 250),
    destructive: oklch(0.68, 0.19, 25),
    highlight: oklch(0.72, 0.15, 300),
  },
}

const WHITE = '#ffffff'
const BLACK = '#000000'

export function clampContrast(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function deriveTheme(config: ThemeConfig, variant: ThemeVariant): ResolvedTheme {
  const bg = config.background
  const fg = config.foreground
  // contrast 50 → 1×; 0 → 0.5×; 100 → 1.5×
  const k = 0.5 + clampContrast(config.contrast) / 100
  const toward = (t: number): string => mixHex(bg, fg, Math.min(1, t * k))
  const isDark = variant === 'dark'

  const raised = isDark ? toward(0.04) : mixHex(bg, WHITE, 0.85)
  const popover = isDark ? toward(0.1) : mixHex(bg, WHITE, 0.95)
  const subtle = toward(0.05)
  const hover = toward(isDark ? 0.12 : 0.045)
  const border = toward(isDark ? 0.08 : 0.11)
  const mutedFg = mixHex(bg, fg, Math.min(0.92, (isDark ? 0.64 : 0.6) * (0.75 + 0.25 * k)))
  const sidebarBg = isDark ? mixHex(bg, BLACK, 0.22) : toward(0.008)
  const sidebarHover = mixHex(sidebarBg, fg, Math.min(1, (isDark ? 0.08 : 0.07) * k))

  const semantic = (key: keyof (typeof SEMANTIC_DEFAULTS)['light']): string =>
    isHexColor(config.semantic[key]) ? config.semantic[key]! : labToHex(SEMANTIC_DEFAULTS[variant][key])

  const primaryFg = isDark ? mixHex(bg, BLACK, 0.15) : mixHex(bg, WHITE, 0.6)
  const success = semantic('success')
  const destructive = semantic('destructive')
  const colors: Record<ThemeTokenName, string> = {
    background: bg,
    foreground: fg,
    card: raised,
    'card-foreground': fg,
    popover,
    'popover-foreground': fg,
    'popover-border': isDark ? mixHex(popover, fg, 0.18) : popover,
    primary: fg,
    'primary-foreground': primaryFg,
    secondary: subtle,
    'secondary-foreground': fg,
    muted: subtle,
    'muted-foreground': mutedFg,
    accent: hover,
    'accent-foreground': fg,
    brand: config.accent,
    'brand-foreground': onColor(config.accent, WHITE, '#111111'),
    destructive,
    'destructive-foreground': onColor(destructive, WHITE, '#111111'),
    success,
    'success-foreground': onColor(success, WHITE, '#111111'),
    warning: semantic('warning'),
    'warning-foreground': onColor(semantic('warning'), WHITE, '#111111'),
    info: semantic('info'),
    'info-foreground': onColor(semantic('info'), WHITE, '#111111'),
    highlight: semantic('highlight'),
    'highlight-foreground': onColor(semantic('highlight'), WHITE, '#111111'),
    'diff-added': isHexColor(config.semantic.diffAdded) ? config.semantic.diffAdded! : success,
    'diff-removed': isHexColor(config.semantic.diffRemoved) ? config.semantic.diffRemoved! : destructive,
    border,
    input: border,
    ring: config.accent,
    'code-background': isDark ? mixHex(bg, BLACK, 0.12) : mixHex(bg, WHITE, 0.6),
    'code-foreground': fg,
    'sidebar-background': sidebarBg,
    'sidebar-foreground': fg,
    'sidebar-primary': fg,
    'sidebar-primary-foreground': primaryFg,
    'sidebar-accent': sidebarHover,
    'sidebar-accent-foreground': fg,
    'sidebar-border': mixHex(sidebarBg, fg, Math.min(1, 0.1 * k)),
    'sidebar-ring': config.accent,
  }

  const cssVars: Record<string, string> = {}
  for (const name of THEME_TOKEN_NAMES) cssVars[`--${name}`] = colors[name]
  cssVars['--font-sans'] = config.fonts.ui?.trim() || DEFAULT_UI_FONT
  cssVars['--font-mono'] = config.fonts.code?.trim() || DEFAULT_CODE_FONT
  cssVars['--shadow-popover'] = isDark
    ? 'inset 0 1px 0 rgb(255 255 255 / 0.08), 0 4px 12px rgb(0 0 0 / 0.3), 0 16px 40px rgb(0 0 0 / 0.4)'
    : '0 0 0 1px rgb(0 0 0 / 0.05), 0 2px 6px rgb(0 0 0 / 0.05), 0 12px 32px rgb(0 0 0 / 0.14)'
  cssVars['--shadow-dialog'] = isDark
    ? 'inset 0 1px 0 rgb(255 255 255 / 0.08), 0 8px 24px rgb(0 0 0 / 0.35), 0 32px 80px rgb(0 0 0 / 0.5)'
    : '0 0 0 1px rgb(0 0 0 / 0.05), 0 8px 20px rgb(0 0 0 / 0.08), 0 24px 64px rgb(0 0 0 / 0.18)'

  return { variant, colors, cssVars }
}

// ---------------------------------------------------------------------------
// Validation + sharing

function normalizeFont(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // Strip characters that could break out of a CSS custom property value.
  const cleaned = value.replace(/[;{}<>\\]/g, '').trim().slice(0, 200)
  return cleaned || null
}

export function normalizeThemeConfig(input: unknown, fallback: ThemeConfig): ThemeConfig {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const fonts = (raw.fonts && typeof raw.fonts === 'object' ? raw.fonts : {}) as Record<string, unknown>
  const semanticIn = (raw.semantic && typeof raw.semantic === 'object' ? raw.semantic : {}) as Record<string, unknown>
  const semantic: ThemeConfig['semantic'] = {}
  for (const key of SEMANTIC_COLOR_KEYS) {
    if (isHexColor(semanticIn[key])) semantic[key] = normalizeHex(semanticIn[key] as string)
  }
  return {
    accent: isHexColor(raw.accent) ? normalizeHex(raw.accent) : fallback.accent,
    background: isHexColor(raw.background) ? normalizeHex(raw.background) : fallback.background,
    foreground: isHexColor(raw.foreground) ? normalizeHex(raw.foreground) : fallback.foreground,
    contrast: typeof raw.contrast === 'number' && Number.isFinite(raw.contrast) ? clampContrast(raw.contrast) : fallback.contrast,
    fonts: { ui: normalizeFont(fonts.ui), code: normalizeFont(fonts.code) },
    semantic,
  }
}

export function normalizeThemeSettings(input: unknown): ThemeSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  return {
    light: normalizeThemeConfig(raw.light, DEFAULT_THEMES.light),
    dark: normalizeThemeConfig(raw.dark, DEFAULT_THEMES.dark),
  }
}

function normalizeHex(hex: string): string {
  let h = hex.trim().replace('#', '').toLowerCase()
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  return `#${h}`
}

const SHARE_PREFIX = 'agentkeeper-theme-v1:'

export function encodeTheme(config: ThemeConfig, variant: ThemeVariant): string {
  return SHARE_PREFIX + JSON.stringify({ variant, theme: config })
}

export function decodeTheme(value: string): { variant: ThemeVariant; theme: ThemeConfig } | null {
  const trimmed = value.trim()
  if (!trimmed.startsWith(SHARE_PREFIX)) return null
  try {
    const parsed = JSON.parse(trimmed.slice(SHARE_PREFIX.length)) as { variant?: unknown; theme?: unknown }
    const variant: ThemeVariant = parsed.variant === 'light' ? 'light' : 'dark'
    return { variant, theme: normalizeThemeConfig(parsed.theme, DEFAULT_THEMES[variant]) }
  } catch {
    return null
  }
}
