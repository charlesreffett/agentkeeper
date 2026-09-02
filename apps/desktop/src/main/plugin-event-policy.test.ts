import { describe, expect, it } from 'vitest'
import { filterPluginSubscription, normalizePluginEmittedEvent } from './plugin-event-policy'

describe('plugin event policy', () => {
  it('forces health events into the emitting plugin namespace', () => {
    expect(normalizePluginEmittedEvent('jira', 'plugin.healthy', { pluginId: 'github' }))
      .toEqual({ event: 'plugin.healthy', payload: { pluginId: 'jira' } })
    expect(normalizePluginEmittedEvent('jira', 'plugin.unhealthy', {
      pluginId: 'github',
      reason: 'auth',
    })).toEqual({ event: 'plugin.unhealthy', payload: { pluginId: 'jira', reason: 'auth' } })
  })

  it('rejects arbitrary emitted events', () => {
    expect(() => normalizePluginEmittedEvent('jira', 'settings.changed', {})).toThrow(
      'Plugin event cannot be emitted',
    )
  })

  it('delivers settings changes only to their owning plugin', () => {
    const own = { pluginId: 'jira', config: { project: 'APP' } }
    expect(filterPluginSubscription('jira', 'settings.changed', own)).toBe(own)
    expect(filterPluginSubscription('github', 'settings.changed', own)).toBeUndefined()
  })

  it('rejects subscriptions to host and lifecycle events', () => {
    expect(() => filterPluginSubscription('jira', 'session.started', {})).toThrow(
      'Plugin event cannot be observed',
    )
  })
})

