import { describe, expect, it } from 'vitest'
import { activeBranchToInitialize } from './draftBranch'

describe('draft branch initialization', () => {
  it('updates a previously initialized draft when the active checkout changes externally', () => {
    expect(activeBranchToInitialize('/repo', 'main', 'feature/external-switch')).toBe(
      'feature/external-switch',
    )
  })

  it('does not initialize without a repository or an active branch', () => {
    expect(activeBranchToInitialize(null, 'main', 'feature')).toBeNull()
    expect(activeBranchToInitialize('/repo', 'main', null)).toBeNull()
  })

  it('does not emit a redundant initialization for the selected active branch', () => {
    expect(activeBranchToInitialize('/repo', 'main', 'main')).toBeNull()
  })
})
