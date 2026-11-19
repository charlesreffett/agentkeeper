import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, nativeTheme: {}, app: { getPath: () => '/tmp' } }))

const { windowAppearance } = await import('./window-appearance')
const { DEFAULT_THEMES } = await import('../shared/theme')

describe('windowAppearance', () => {
  const base = { theme: 'system' as const, themes: DEFAULT_THEMES, translucentSidebar: false }

  it('uses the resolved theme background when opaque', () => {
    expect(windowAppearance(base, 'darwin', true)).toEqual({ backgroundColor: DEFAULT_THEMES.dark.background, vibrancy: null })
    expect(windowAppearance({ ...base, theme: 'light' }, 'darwin', true).backgroundColor).toBe(DEFAULT_THEMES.light.background)
  })

  it('goes transparent with vibrancy only on macOS', () => {
    expect(windowAppearance({ ...base, translucentSidebar: true }, 'darwin', false)).toEqual({ backgroundColor: '#00000000', vibrancy: 'sidebar' })
    expect(windowAppearance({ ...base, translucentSidebar: true }, 'win32', false).vibrancy).toBeNull()
  })
})
