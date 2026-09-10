import { describe, expect, it, vi } from 'vitest'
import type { PluginRecord, WorkItemReference } from '@shared/ipc-contract'
import { refreshProviderWorkItems, workItemReferenceKey } from './useProviderWorkItems'

const reference = (sourceId = 'github', itemId = '42'): WorkItemReference => ({
  sourceId, itemId, externalRef: 'GH-42', title: 'Offline title',
})

const plugin = (overrides: Partial<PluginRecord> = {}): PluginRecord => ({
  id: 'github', name: 'GitHub', version: '1.0.0', enabled: true, source: 'local',
  status: 'active', manifest: {} as PluginRecord['manifest'], actionRequired: false,
  grantedAuthority: { permissions: [], networkHosts: [], environmentVariables: [] },
  ...overrides,
})

describe('provider-backed plan work items', () => {
  it('requests current provider data for a provider-addressed reference', async () => {
    const get = vi.fn().mockResolvedValue({ id: '42', source: 'github', externalRef: 'GH-42', title: 'Current', body: '', status: 'done', links: [] })
    const result = await refreshProviderWorkItems([reference()], async () => [plugin()], get)
    expect(get).toHaveBeenCalledWith({ sourceId: 'github', itemId: '42', externalRef: 'GH-42', title: 'Offline title' })
    expect(result.get(workItemReferenceKey(reference()))).toMatchObject({ status: 'available', item: { title: 'Current', status: 'done' } })
  })

  it.each([
    ['absent', []],
    ['disabled', [plugin({ enabled: false, status: 'inactive' })]],
    ['disconnected', [plugin({ status: 'inactive' })]],
    ['unhealthy', [plugin({ status: 'unhealthy' })]],
  ])('normalizes an %s provider to unavailable without invoking it', async (_name, plugins) => {
    const get = vi.fn()
    const result = await refreshProviderWorkItems([reference()], async () => plugins, get)
    expect(result.get(workItemReferenceKey(reference()))).toEqual({ status: 'unavailable' })
    expect(get).not.toHaveBeenCalled()
  })

  it('normalizes provider listing, lookup errors, and missing items to unavailable', async () => {
    const key = workItemReferenceKey(reference())
    await expect(refreshProviderWorkItems([reference()], async () => { throw new Error('offline') }, vi.fn()))
      .resolves.toEqual(new Map([[key, { status: 'unavailable' }]]))
    await expect(refreshProviderWorkItems([reference()], async () => [plugin()], async () => { throw new Error('auth') }))
      .resolves.toEqual(new Map([[key, { status: 'unavailable' }]]))
    await expect(refreshProviderWorkItems([reference()], async () => [plugin()], async () => undefined))
      .resolves.toEqual(new Map([[key, { status: 'unavailable' }]]))
  })
})
