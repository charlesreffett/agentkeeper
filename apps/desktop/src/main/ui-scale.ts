import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { UI_FONT_SIZE, clampFontSize, uiZoomFactor } from '../shared/theme'
import { settingsStore } from './settings'

export type UiFontSizeStep = 1 | -1 | 'reset'

export function nextUiFontSize(current: number, step: UiFontSizeStep): number {
  if (step === 'reset') return UI_FONT_SIZE.default
  return clampFontSize(current + step, UI_FONT_SIZE)
}

/**
 * The single path for zoom gestures (View menu, Ctrl/Cmd+scroll). Routing them
 * through the uiFontSize setting keeps one zoom level that survives restarts
 * and stays in sync with the Appearance page.
 */
export function stepUiFontSize(step: UiFontSizeStep): void {
  const current = settingsStore.get().uiFontSize
  const next = nextUiFontSize(current, step)
  if (next === current) return
  settingsStore.set({ uiFontSize: next })
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.setZoomFactor(uiZoomFactor(next))
    win.webContents.send(IPC_CHANNELS.settingsUiFontSizeChanged, next)
  }
}
