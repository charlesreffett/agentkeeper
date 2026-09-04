import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUIContributionsStore } from './uiContributions'

describe('plugin UI contributions', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('upserts contributions by plugin and id', () => {
    const store = useUIContributionsStore()
    store.contribute('one', 'registration-old', 'sidebar.primary', { id: 'home', label: 'Old' })
    store.contribute('one', 'registration-new', 'sidebar.primary', { id: 'home', label: 'New' })
    store.contribute('two', 'registration-two', 'sidebar.primary', { id: 'home', label: 'Other plugin' })

    expect(store.getSlot('sidebar.primary')).toEqual([
      { id: 'home', label: 'New' },
      { id: 'home', label: 'Other plugin' },
    ])
  })

  it('revokes every contribution owned by a stopped plugin', () => {
    const store = useUIContributionsStore()
    store.contribute('one', 'home', 'sidebar.primary', { id: 'home' })
    store.contribute('one', 'command', 'commandPalette', { id: 'command' })
    store.contribute('two', 'other', 'sidebar.primary', { id: 'other' })

    store.revokePlugin('one')

    expect(store.getSlot('sidebar.primary')).toEqual([{ id: 'other' }])
    expect(store.getSlot('commandPalette')).toEqual([])
  })

  it('drops malformed slots and payloads', () => {
    const store = useUIContributionsStore()
    store.contribute('one', '1', 'made.up', { id: 'bad-slot' })
    store.contribute('one', '2', 'sidebar.primary', { label: 'missing id' })
    store.contribute('one', '3', 'sidebar.primary', { id: 'bad-order', order: Number.NaN })
    expect(store.getSlot('sidebar.primary')).toEqual([])
  })

  it('honors a plugin disposer without affecting another registration', () => {
    const store = useUIContributionsStore()
    store.contribute('one', 'registration-one', 'sidebar.primary', { id: 'one' })
    store.contribute('one', 'registration-two', 'sidebar.primary', { id: 'two' })
    store.remove('one', 'registration-one')
    expect(store.getSlot('sidebar.primary')).toEqual([{ id: 'two' }])
  })
})
