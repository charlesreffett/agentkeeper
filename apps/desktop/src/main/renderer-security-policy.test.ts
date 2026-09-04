import { describe, expect, it } from 'vitest'
import { RENDERER_SECURITY_WEB_PREFERENCES } from './renderer-security-policy'

describe('renderer process security policy', () => {
  it('keeps Node out of a Chromium-sandboxed, context-isolated renderer', () => {
    expect(RENDERER_SECURITY_WEB_PREFERENCES).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    })
  })
})
