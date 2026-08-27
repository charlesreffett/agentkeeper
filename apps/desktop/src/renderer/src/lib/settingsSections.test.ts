import { describe, expect, it } from 'vitest'
import { settingsSections } from './settingsSections'

describe('Settings information architecture', () => {
  it('exposes unique, directly addressable sections', () => {
    expect(new Set(settingsSections.map(item => item.path)).size).toBe(settingsSections.length)
    expect(settingsSections.map(item => [item.path, item.label])).toEqual(expect.arrayContaining([
      ['/settings/models', 'Models & Harnesses'],
      ['/settings/appearance', 'Appearance'],
      ['/settings/plugins', 'Plugins'],
      ['/settings/remote', 'Remote'],
      ['/settings/github', 'GitHub'],
      ['/settings/jira', 'Jira'],
    ]))
  })
})
