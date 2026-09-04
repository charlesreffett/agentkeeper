import { describe, expect, it } from 'vitest'
import {
  PLUGIN_IFRAME_CSP,
  normalizePluginPath,
  normalizeRequestedExternalUrl,
  parsePluginBridgeRequest,
  resolveDeclaredPluginRoute,
} from './plugin-view-policy'

describe('plugin view boundary policy', () => {
  it('blocks every remote-loading CSP directive', () => {
    expect(PLUGIN_IFRAME_CSP).toContain("default-src 'none'")
    expect(PLUGIN_IFRAME_CSP).toContain("connect-src 'none'")
    expect(PLUGIN_IFRAME_CSP).not.toMatch(/https?:/)
    expect(PLUGIN_IFRAME_CSP).not.toContain('img-src data: https:')
  })

  it('canonicalizes safe paths and preserves encoded slash data', () => {
    expect(normalizePluginPath('pulls/owner%2Frepo/42')).toBe('pulls/owner%2Frepo/42')
    expect(normalizePluginPath('pulls/a%20b')).toBe('pulls/a%20b')
  })

  it('rejects absolute, malformed, and encoded traversal paths', () => {
    for (const path of [
      '/settings', '../settings', 'pulls/../settings', 'pulls/%2e%2e/settings',
      'pulls/%252e%252e/settings', 'pulls\\..\\settings', 'pulls//settings',
      'pulls?next=/settings', 'pulls/%E0%A4%A',
    ]) expect(normalizePluginPath(path)).toBeNull()
  })

  it('keeps navigation inside a declared route and selects the most specific view', () => {
    const routes = [
      { path: 'pulls', view: 'list' },
      { path: 'pulls/detail', view: 'detail' },
      { path: 'settings', view: 'settings' },
    ]
    expect(resolveDeclaredPluginRoute('pulls/owner%2Frepo/42', routes)).toEqual({
      path: 'pulls/owner%2Frepo/42', view: 'list',
    })
    expect(resolveDeclaredPluginRoute('pulls/detail/42', routes)).toEqual({
      path: 'pulls/detail/42', view: 'detail',
    })
    expect(resolveDeclaredPluginRoute('admin', routes)).toBeNull()
  })

  it('accepts only token-bound, size-limited bridge messages', () => {
    expect(parsePluginBridgeRequest({ channel: 'agentkeeper-plugin', token: 'right', type: 'ready' }, 'right'))
      .toMatchObject({ type: 'ready' })
    expect(parsePluginBridgeRequest({ channel: 'agentkeeper-plugin', token: 'wrong', type: 'ready' }, 'right')).toBeNull()
    expect(parsePluginBridgeRequest({ channel: 'agentkeeper-plugin', token: 'right', type: 'invoke' }, 'right')).toBeNull()
    expect(parsePluginBridgeRequest({
      channel: 'agentkeeper-plugin', token: 'right', type: 'invoke', id: '1', command: 'x', args: 'x'.repeat(1_048_577),
    }, 'right')).toBeNull()
    expect(parsePluginBridgeRequest({ channel: 'agentkeeper-plugin', token: 'right', type: 'unknown' }, 'right')).toBeNull()
  })

  it('allows only ordinary credential-free HTTP(S) external requests', () => {
    expect(normalizeRequestedExternalUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(normalizeRequestedExternalUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeRequestedExternalUrl('https://user:secret@example.com')).toBeNull()
  })
})
