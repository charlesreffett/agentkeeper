import { describe, expect, it } from 'vitest'
import { formatContextWindow } from './useModelsQuery'
import { resolveModelSelectionState } from './useHarnessCapabilities'

describe('model catalog presentation', () => {
  it('formats provider context metadata compactly and omits unknown values', () => {
    expect(formatContextWindow(200_000)).toBe('200K context')
    expect(formatContextWindow(1_000_000)).toBe('1M context')
    expect(formatContextWindow(undefined)).toBeUndefined()
  })

  it('uses declared mutability instead of harness identity', () => {
    expect(resolveModelSelectionState('idle', false, 'running')).toEqual({
      enabled: false,
      reason: 'Wait for the current turn to finish before changing models.',
    })
    expect(resolveModelSelectionState('idle', false, 'idle')).toEqual({ enabled: true })
    expect(resolveModelSelectionState('draft-only', true, 'running')).toEqual({ enabled: true })
  })
})
