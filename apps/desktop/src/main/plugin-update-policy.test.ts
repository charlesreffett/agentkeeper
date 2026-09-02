import { describe, expect, it } from 'vitest'
import { assertReleaseIdentity, comparePluginVersions } from './plugin-update-policy'

describe('plugin update policy', () => {
  it('compares stable and prerelease versions', () => {
    expect(comparePluginVersions('1.2.1', '1.2.0')).toBeGreaterThan(0)
    expect(comparePluginVersions('2.0.0-beta.2', '2.0.0-beta.1')).toBeGreaterThan(0)
    expect(comparePluginVersions('2.0.0', '2.0.0-beta.2')).toBeGreaterThan(0)
    expect(comparePluginVersions('1.2.0', '1.2.0')).toBe(0)
  })

  it('binds package ID and version to the selected release', () => {
    expect(() => assertReleaseIdentity({ id: 'jira', version: '1.1.0' }, { id: 'github', version: '1.1.0' }, '1.0.0')).toThrow('ID mismatch')
    expect(() => assertReleaseIdentity({ id: 'jira', version: '1.1.0' }, { id: 'jira', version: '1.2.0' }, '1.0.0')).toThrow('version mismatch')
  })

  it('rejects equal versions and downgrades', () => {
    expect(() => assertReleaseIdentity({ id: 'jira', version: '1.0.0' }, { id: 'jira', version: '1.0.0' }, '1.0.0')).toThrow('must be newer')
    expect(() => assertReleaseIdentity({ id: 'jira', version: '0.9.0' }, { id: 'jira', version: '0.9.0' }, '1.0.0')).toThrow('must be newer')
  })
})
