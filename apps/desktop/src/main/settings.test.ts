import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataPath },
}))

import { settingsStore } from './settings'

describe('plugin developer-mode settings', () => {
  beforeEach(() => {
    state.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeeper-settings-'))
  })

  afterEach(() => {
    fs.rmSync(state.userDataPath, { recursive: true, force: true })
  })

  it('defaults to disabled when no setting has been persisted', () => {
    expect(settingsStore.get().pluginDeveloperMode).toBe(false)
  })

  it('accepts only the literal persisted boolean true', () => {
    const settingsPath = path.join(state.userDataPath, 'settings.json')
    fs.writeFileSync(settingsPath, JSON.stringify({ pluginDeveloperMode: 'true' }))
    expect(settingsStore.get().pluginDeveloperMode).toBe(false)

    fs.writeFileSync(settingsPath, JSON.stringify({ pluginDeveloperMode: true }))
    expect(settingsStore.get().pluginDeveloperMode).toBe(true)
  })

  it('persists changes only through the dedicated boolean setter', () => {
    expect(settingsStore.setPluginDeveloperMode(true).pluginDeveloperMode).toBe(true)
    expect(settingsStore.get().pluginDeveloperMode).toBe(true)
    expect(settingsStore.setPluginDeveloperMode(false).pluginDeveloperMode).toBe(false)
  })
})
