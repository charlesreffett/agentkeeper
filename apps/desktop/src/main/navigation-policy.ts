import net from 'node:net'

const MAX_EXTERNAL_URL_LENGTH = 2_048

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }
  const a = parts[0]!
  const b = parts[1]!
  return a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  if (!normalized.includes('.') || normalized === 'localhost' || normalized.endsWith('.localhost')
    || normalized.endsWith('.local') || normalized.endsWith('.lan')
    || normalized.endsWith('.internal') || normalized.endsWith('.home.arpa')) return true
  if (net.isIPv4(normalized)) return isPrivateIpv4(normalized)
  const compact = normalized.replace(/^\[|\]$/g, '')
  if (net.isIPv6(compact)) {
    return compact === '::' || compact === '::1' || compact.startsWith('fc')
      || compact.startsWith('fd') || compact.startsWith('fe8') || compact.startsWith('fe9')
      || compact.startsWith('fea') || compact.startsWith('feb')
  }
  return false
}

/**
 * Only browser-safe URLs may cross from renderer content to the operating
 * system. Local-network targets are intentionally excluded: opening one can
 * turn a seemingly harmless link into a state-changing request to a local
 * service.
 */
export function normalizeExternalUrl(value: string): string | null {
  if (value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    return null
  }
  try {
    const target = new URL(value)
    if (target.protocol !== 'https:' && target.protocol !== 'http:') return null
    if (target.username || target.password || !target.hostname || isPrivateHostname(target.hostname)) return null
    return target.href
  } catch {
    return null
  }
}

/** Allow only the exact document the BrowserWindow was created to display. */
export function isTrustedRendererNavigation(candidateValue: string, rendererEntryValue: string): boolean {
  try {
    const candidate = new URL(candidateValue)
    const rendererEntry = new URL(rendererEntryValue)
    return candidate.protocol === rendererEntry.protocol
      && candidate.origin === rendererEntry.origin
      && candidate.pathname === rendererEntry.pathname
      && candidate.search === rendererEntry.search
  } catch {
    return false
  }
}
