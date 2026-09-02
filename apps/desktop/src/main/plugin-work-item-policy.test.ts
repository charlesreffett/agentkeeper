import { describe, expect, it } from 'vitest'
import { assertOwnedWorkItemSource } from './plugin-work-item-policy'

describe('plugin work-item ownership', () => {
  it('accepts the source owned by the plugin', () => {
    expect(() => assertOwnedWorkItemSource('jira', 'jira')).not.toThrow()
  })

  it('rejects registering or unregistering another plugin source', () => {
    expect(() => assertOwnedWorkItemSource('jira', 'github')).toThrow(
      'Plugin jira cannot manage work-item source github',
    )
  })
})

