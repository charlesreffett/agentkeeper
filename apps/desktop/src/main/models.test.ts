import { beforeEach, describe, expect, it, vi } from 'vitest'

const { adapter, send, settings } = vi.hoisted(() => ({
  send: vi.fn(),
  settings: { customModels: {} as Record<string, string[]> },
  adapter: {
    id: 'test',
    capabilities: { customModels: false },
    getSupportedModels: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  webContents: { getAllWebContents: () => [{ isDestroyed: () => false, send }] },
}))
vi.mock('./harness', () => ({ getHarness: () => adapter }))
vi.mock('./settings', () => ({ settingsStore: { get: () => settings } }))

import { getAvailableModels, refreshAvailableModels, resetModelSnapshotsForTest } from './models'

describe('model snapshots', () => {
  beforeEach(() => {
    resetModelSnapshotsForTest()
    adapter.getSupportedModels.mockReset()
    adapter.capabilities.customModels = false
    send.mockReset()
  })

  it('deduplicates concurrent discovery', async () => {
    adapter.getSupportedModels.mockResolvedValue([{ value: 'one', label: 'One' }])
    const [a, b] = await Promise.all([refreshAvailableModels('test'), refreshAvailableModels('test')])
    expect(adapter.getSupportedModels).toHaveBeenCalledTimes(1)
    expect(a.models).toEqual(b.models)
  })

  it('retains the last successful catalog after a refresh error', async () => {
    adapter.getSupportedModels.mockResolvedValueOnce([{ value: 'one', label: 'One' }])
    await getAvailableModels('test')
    adapter.getSupportedModels.mockRejectedValueOnce(new Error('offline'))

    const result = await refreshAvailableModels('test')

    expect(result.status).toBe('error')
    expect(result.error).toBe('offline')
    expect(result.models).toEqual([{ value: 'one', label: 'One' }])
  })

  it('returns successful cached data without rediscovery', async () => {
    adapter.getSupportedModels.mockResolvedValue([{ value: 'one', label: 'One' }])
    await getAvailableModels('test')
    const cached = await getAvailableModels('test')
    expect(cached.status).toBe('cached')
    expect(adapter.getSupportedModels).toHaveBeenCalledTimes(1)
  })

  it('normalizes and deduplicates configured custom models', async () => {
    adapter.capabilities.customModels = true
    settings.customModels.test = [' vendor/model ', 'vendor/model', 'bad model']
    adapter.getSupportedModels.mockResolvedValue([])
    const result = await getAvailableModels('test')
    expect(result.models).toEqual([{
      value: 'vendor/model', label: 'vendor/model', resolvedModel: 'vendor/model', isCustom: true,
    }])
    delete settings.customModels.test
  })
})
