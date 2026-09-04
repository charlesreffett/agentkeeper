import { describe, expect, it } from 'vitest'
import { isTrustedRendererNavigation, normalizeExternalUrl } from './navigation-policy'

describe('external navigation policy', () => {
  it('accepts ordinary web links and canonicalizes them', () => {
    expect(normalizeExternalUrl('https://Example.com/docs?q=1')).toBe('https://example.com/docs?q=1')
    expect(normalizeExternalUrl('http://example.com/')).toBe('http://example.com/')
  })

  it('rejects non-web schemes, credentials, local services, and oversized input', () => {
    expect(normalizeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(normalizeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeExternalUrl('https://user:secret@example.com/')).toBeNull()
    expect(normalizeExternalUrl('http://localhost:3000/action')).toBeNull()
    expect(normalizeExternalUrl('http://router/action')).toBeNull()
    expect(normalizeExternalUrl('http://printer.local/action')).toBeNull()
    expect(normalizeExternalUrl('http://127.0.0.1/action')).toBeNull()
    expect(normalizeExternalUrl('http://[::1]/action')).toBeNull()
    expect(normalizeExternalUrl(`https://example.com/${'a'.repeat(2_100)}`)).toBeNull()
  })

  it('does not confuse lookalike hostnames with the trusted renderer', () => {
    const entry = 'http://localhost:5173/index.html'
    expect(isTrustedRendererNavigation('http://localhost:5173/index.html#/settings', entry)).toBe(true)
    expect(isTrustedRendererNavigation('http://localhost.evil:5173/index.html', entry)).toBe(false)
    expect(isTrustedRendererNavigation('http://localhost:5173/other.html', entry)).toBe(false)
  })

  it('allows only the packaged renderer entry file', () => {
    const entry = 'file:///Applications/AgentKeeper/resources/app/out/renderer/index.html'
    expect(isTrustedRendererNavigation(`${entry}#/plugin/example/home`, entry)).toBe(true)
    expect(isTrustedRendererNavigation('file:///etc/passwd', entry)).toBe(false)
  })
})
