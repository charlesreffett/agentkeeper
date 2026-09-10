import { describe, expect, it } from 'vitest'
import { assertOwnedWorkItemProvider, PluginWorkItemOwnership } from './plugin-work-item-policy'

describe('plugin work-item ownership', () => {
  it('accepts the source owned by the plugin', () => {
    expect(() => assertOwnedWorkItemProvider('jira', 'jira')).not.toThrow()
  })

  it('rejects registering or unregistering another plugin source', () => {
    expect(() => assertOwnedWorkItemProvider('jira', 'github')).toThrow(
      'Plugin jira cannot manage work-item provider github',
    )
  })

  it('removes every owned source when a plugin host exits', () => {
    const sources = new Map<string, { id: string }>()
    const ownership = new PluginWorkItemOwnership('jira', {
      register: source => { sources.set(source.id, source) },
      unregister: sourceId => { sources.delete(sourceId) },
    })
    ownership.register({ id: 'jira' })
    expect(sources.has('jira')).toBe(true)

    ownership.dispose()

    expect(sources.has('jira')).toBe(false)
  })
})
