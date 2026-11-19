import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, app: { getPath: () => '' } }))

import { nextUiFontSize } from './ui-scale'

describe('nextUiFontSize', () => {
  it('steps by one pixel within the allowed range', () => {
    expect(nextUiFontSize(14, 1)).toBe(15)
    expect(nextUiFontSize(14, -1)).toBe(13)
    expect(nextUiFontSize(20, 1)).toBe(20)
    expect(nextUiFontSize(11, -1)).toBe(11)
  })

  it('resets to the default size', () => {
    expect(nextUiFontSize(18, 'reset')).toBe(14)
  })
})
