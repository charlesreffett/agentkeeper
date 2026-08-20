import { describe, expect, it } from 'vitest'
import { modelSelectionRejection } from './model-mutability'

describe('main-process model mutability', () => {
  it('allows idle-capable harnesses only between turns', () => {
    expect(modelSelectionRejection('idle', 'idle')).toBeNull()
    expect(modelSelectionRejection('idle', 'running')?.reason).toBe('session-running')
  })

  it('rejects all live changes for draft-only harnesses', () => {
    expect(modelSelectionRejection('draft-only', 'idle')?.reason).toBe('model-selection-unsupported')
  })

  it('allows turn-capable harnesses during a running turn', () => {
    expect(modelSelectionRejection('turn', 'running')).toBeNull()
  })
})
