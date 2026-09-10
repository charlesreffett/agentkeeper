// Chromium ignores the non-standard `navigate-to` and `webrtc` directives and
// logs a console error for each. Frame navigation is blocked authoritatively by
// the main process; network access is denied here and plugin API traffic is
// mediated by the host bridge.
export const PLUGIN_IFRAME_CSP = [
  "default-src 'none'",
  "script-src data:",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')

const MAX_ROUTE_LENGTH = 2_048
const MAX_IDENTIFIER_LENGTH = 256
const MAX_EXTERNAL_URL_LENGTH = 2_048
const MAX_BRIDGE_ARGS_LENGTH = 1_048_576

export interface PluginRouteLike {
  path: string
  view: string
}

export type ValidBridgeRequest =
  | { channel: 'agentkeeper-plugin'; token: string; type: 'ready' }
  | { channel: 'agentkeeper-plugin'; token: string; type: 'invoke'; id: string; command: string; args?: unknown }
  | { channel: 'agentkeeper-plugin'; token: string; type: 'navigate'; path: string }
  | { channel: 'agentkeeper-plugin'; token: string; type: 'openExternal'; url: string }
  | { channel: 'agentkeeper-plugin'; token: string; type: 'startSession'; itemId: string; projectPath?: string }
  | { channel: 'agentkeeper-plugin'; token: string; type: 'workItemSessions'; id: string; itemId?: string }
  | { channel: 'agentkeeper-plugin'; token: string; type: 'openSession'; sessionId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedString(value: unknown, maxLength = MAX_IDENTIFIER_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function boundedOptionalString(value: unknown, maxLength = MAX_IDENTIFIER_LENGTH): value is string | undefined {
  return value === undefined || boundedString(value, maxLength)
}

function hasSafeSerializedSize(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined || serialized.length <= MAX_BRIDGE_ARGS_LENGTH
  } catch {
    return false
  }
}

/** Parse, size-limit, and narrow messages from an untrusted plugin frame. */
export function parsePluginBridgeRequest(value: unknown, expectedToken: string): ValidBridgeRequest | null {
  if (!isRecord(value) || value.channel !== 'agentkeeper-plugin' || value.token !== expectedToken) return null
  switch (value.type) {
    case 'ready':
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'ready' }
    case 'invoke':
      if (!boundedString(value.id, 128) || !boundedString(value.command) || !hasSafeSerializedSize(value.args)) return null
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'invoke', id: value.id, command: value.command, args: value.args }
    case 'navigate':
      if (!boundedString(value.path, MAX_ROUTE_LENGTH)) return null
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'navigate', path: value.path }
    case 'openExternal':
      if (!boundedString(value.url, MAX_EXTERNAL_URL_LENGTH)) return null
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'openExternal', url: value.url }
    case 'startSession':
      if (!boundedString(value.itemId) || !boundedOptionalString(value.projectPath, MAX_ROUTE_LENGTH)) return null
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'startSession', itemId: value.itemId, projectPath: value.projectPath }
    case 'workItemSessions':
      if (!boundedString(value.id, 128) || !boundedOptionalString(value.itemId)) return null
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'workItemSessions', id: value.id, itemId: value.itemId }
    case 'openSession':
      if (!boundedString(value.sessionId)) return null
      return { channel: 'agentkeeper-plugin', token: expectedToken, type: 'openSession', sessionId: value.sessionId }
    default:
      return null
  }
}

function repeatedlyDecode(value: string): string | null {
  let decoded = value
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let next: string
    try {
      next = decodeURIComponent(decoded)
    } catch {
      return null
    }
    if (next === decoded) return next
    decoded = next
  }
  // Excessive encoding is ambiguous across URL/router implementations.
  return null
}

/**
 * Produce a relative, canonical path for the hash router. Encoded slashes are
 * retained as segment data (repository IDs use them), while dot segments are
 * rejected even when encoded multiple times.
 */
export function normalizePluginPath(value: string): string | null {
  if (value.length === 0 || value.length > MAX_ROUTE_LENGTH || value.startsWith('/')
    || value.includes('\\') || /[\u0000-\u001f\u007f?#]/.test(value)) return null

  const canonicalSegments: string[] = []
  for (const rawSegment of value.split('/')) {
    if (!rawSegment) return null
    let decoded: string
    try {
      decoded = decodeURIComponent(rawSegment)
    } catch {
      return null
    }
    const validationValue = repeatedlyDecode(decoded)
    if (validationValue === null || validationValue.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(validationValue)
      || validationValue.split('/').some(part => part === '.' || part === '..')) return null
    canonicalSegments.push(encodeURIComponent(decoded))
  }
  return canonicalSegments.join('/')
}

export function resolveDeclaredPluginRoute(
  requestedPath: string,
  routes: readonly PluginRouteLike[],
): { path: string; view: string } | null {
  const path = normalizePluginPath(requestedPath)
  if (!path) return null
  const declared = [...routes]
    .sort((a, b) => b.path.length - a.path.length)
    .find(route => path === route.path || path.startsWith(`${route.path}/`))
  return declared ? { path, view: declared.view } : null
}

/** First-stage filtering; the main process performs the authoritative check. */
export function normalizeRequestedExternalUrl(value: string): string | null {
  if (value.length === 0 || value.length > MAX_EXTERNAL_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return null
  try {
    const target = new URL(value)
    if ((target.protocol !== 'https:' && target.protocol !== 'http:') || target.username || target.password || !target.hostname) return null
    return target.href
  } catch {
    return null
  }
}
