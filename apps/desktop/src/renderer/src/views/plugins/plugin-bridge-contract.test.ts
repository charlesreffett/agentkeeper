import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PluginRendererApi } from '@agentkeeper/sdk'

// The bridge is an inline script string, so the compiler can't check it
// against the SDK. Typing this record as exhaustive makes adding an SDK member
// fail typecheck here until the host implements it.
const MEMBERS: Record<keyof PluginRendererApi, true> = {
  pluginId: true,
  viewId: true,
  getRoute: true,
  onRouteChanged: true,
  navigate: true,
  invoke: true,
  openExternal: true,
  startSession: true,
  getWorkItemSessions: true,
  openSession: true,
  getTheme: true,
  onThemeChanged: true,
}

describe('plugin renderer bridge', () => {
  it('implements every PluginRendererApi member', () => {
    const source = readFileSync(resolve(__dirname, 'PluginView.vue'), 'utf8')
    const bridge = source.slice(source.indexOf('window.agentkeeperPlugin = Object.freeze({'))
    for (const member of Object.keys(MEMBERS)) {
      expect(bridge, member).toMatch(new RegExp(`\\b${member}(\\(|:)`))
    }
  })
})
