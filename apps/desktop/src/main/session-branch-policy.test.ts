import { describe, expect, it } from 'vitest'
import { liveSessionBlocksBranchSwitch } from './session-branch-policy'

describe('live-session branch policy', () => {
  it('allows another session to use the branch already checked out', () => {
    expect(liveSessionBlocksBranchSwitch(true, 'feat/current', 'feat/current')).toBe(false)
  })

  it('blocks changing a shared checkout beneath a live session', () => {
    expect(liveSessionBlocksBranchSwitch(true, 'main', 'feat/other')).toBe(true)
  })

  it('does not constrain branch switches without a live session', () => {
    expect(liveSessionBlocksBranchSwitch(false, 'main', 'feat/other')).toBe(false)
  })
})
