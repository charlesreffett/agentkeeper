// Single source of truth for the role accent palette.
// Every node, handle, edge gradient, and avatar reads from here so a role's
// color stays consistent across the graph and the side panels.
//
// An accent can be either a named palette entry ("blue", "orange", …) or any
// raw CSS color string (hex / hsl / rgb). Named entries come from a role's
// frontmatter; raw colors are derived per node so every node stays distinct
// even when roles don't declare an accent.

export const ACCENT_HEX: Record<string, string> = {
  blue: '#3b82f6',
  orange: '#f59e0b',
  purple: '#8b5cf6',
  teal: '#14b8a6',
  green: '#22c55e',
  red: '#ef4444',
}

export const ACCENT_NAMES = Object.keys(ACCENT_HEX)

const COLOR_STRING_RE = /^(#|(?:hsl|rgb)a?\()/i

function isColorString(value: string): boolean {
  return COLOR_STRING_RE.test(value)
}

/** Resolve an accent to a usable CSS color. Unknown names fall back to blue. */
export function accentColor(accent?: string | null): string {
  if (accent && isColorString(accent)) return accent
  return ACCENT_HEX[accent ?? 'blue'] ?? ACCENT_HEX['blue']!
}

/** ~15% tint of the accent, used for icon/avatar backgrounds. */
export function accentBg(accent?: string | null): string {
  const color = accentColor(accent)
  if (color.startsWith('hsl(')) return color.replace('hsl(', 'hsla(').replace(')', ', 0.15)')
  if (color.startsWith('rgb(')) return color.replace('rgb(', 'rgba(').replace(')', ', 0.15)')
  return `${color}26`
}

/** Scale a hex or hsl color toward black. Returns a plain color string valid in both CSS and SVG attributes. */
export function darken(color: string, factor: number): string {
  if (color.startsWith('#')) {
    const hex = color.slice(1)
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex
    const mix = (v: number) => Math.round(v * factor).toString(16).padStart(2, '0')
    return `#${mix(parseInt(full.slice(0, 2), 16))}${mix(parseInt(full.slice(2, 4), 16))}${mix(parseInt(full.slice(4, 6), 16))}`
  }
  const hslMatch = /^hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)$/.exec(color)
  if (hslMatch) {
    const [, h, s, l] = hslMatch
    return `hsl(${h}, ${s}%, ${Math.round(Number(l) * factor)}%)`
  }
  return color
}

/** Solid (slightly darkened) accent — matches the connection-point dots. */
export function accentSolid(accent?: string | null): string {
  return darken(accentColor(accent), 0.82)
}

// Golden-angle hue stepping spreads every node on its own hue so nodes stay
// visually distinct even without an explicit accent.
export function derivedAccent(index: number): string {
  const hue = (index * 137.508) % 360
  return `hsl(${hue.toFixed(1)}, 70%, 55%)`
}
