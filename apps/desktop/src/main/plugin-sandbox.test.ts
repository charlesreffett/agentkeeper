import { describe, expect, it } from 'vitest'
import { buildPluginSandboxDocument, PLUGIN_SANDBOX_CSP } from './plugin-sandbox'
import { PLUGIN_WORKER_RUNTIME_SOURCE } from './plugin-sandbox-runtime'

describe('plugin browser sandbox', () => {
  it('denies ambient network, frames, media, forms, and object capabilities', () => {
    expect(PLUGIN_SANDBOX_CSP).toContain("default-src 'none'")
    expect(PLUGIN_SANDBOX_CSP).toContain("connect-src 'none'")
    expect(PLUGIN_SANDBOX_CSP).toContain("img-src 'none'")
    expect(PLUGIN_SANDBOX_CSP).toContain("frame-src 'none'")
    expect(PLUGIN_SANDBOX_CSP).toContain("form-action 'none'")
    expect(PLUGIN_SANDBOX_CSP).toContain("webrtc 'block'")
  })

  it('keeps plugin source out of the trusted launcher document', () => {
    const document = buildPluginSandboxDocument()
    expect(document).toContain(PLUGIN_SANDBOX_CSP)
    expect(document).toContain('new Worker(')
    expect(document).toContain("worker.postMessage({ type: 'sandbox.bootstrap', pluginSource: payload.pluginSource, startupId: payload.startupId })")
  })

  it('uses host brokers rather than ambient fetch or process APIs', () => {
    expect(PLUGIN_WORKER_RUNTIME_SOURCE).toContain('network.fetch')
    expect(PLUGIN_WORKER_RUNTIME_SOURCE).toContain('nativeProcess.execFile')
    expect(PLUGIN_WORKER_RUNTIME_SOURCE).not.toContain("import('electron")
    expect(PLUGIN_WORKER_RUNTIME_SOURCE).not.toContain("import('node:")
  })
})
