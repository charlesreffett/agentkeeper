import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ userDataPath: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => state.userDataPath },
}))

import { settingsStore } from './settings'
import { DEFAULT_THEMES } from '../shared/theme'

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

describe('theme settings persistence', () => {
  beforeEach(() => {
    state.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agentkeeper-settings-'))
  })

  afterEach(() => {
    fs.rmSync(state.userDataPath, { recursive: true, force: true })
  })

  it('keeps untouched theme slots off disk so default changes still apply', () => {
    const custom = { ...DEFAULT_THEMES.dark, accent: '#ff79c6' }
    settingsStore.set({ notifications: 'toast', themes: { light: DEFAULT_THEMES.light, dark: custom } })
    const onDisk = JSON.parse(fs.readFileSync(path.join(state.userDataPath, 'settings.json'), 'utf8'))
    expect(onDisk.themes).toEqual({ dark: custom })
    expect(settingsStore.get().themes).toEqual({ light: DEFAULT_THEMES.light, dark: custom })
  })
})
