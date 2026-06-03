import { ipcMain, webContents } from 'electron'
import * as pty from 'node-pty'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { IPC_CHANNELS } from '../shared/ipc-contract'

const terminals = new Map<string, pty.IPty>()
const outputBuffers = new Map<string, string>()

const BUFFER_MAX = 50_000

function appendBuffer(id: string, data: string): void {
  const prev = outputBuffers.get(id) ?? ''
  const next = prev + data
  outputBuffers.set(id, next.length > BUFFER_MAX ? next.slice(next.length - BUFFER_MAX) : next)
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.terminalCreate, (_e, cwd: string) => {
    const id = randomUUID()
    const shell = process.env['SHELL'] ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/bash')
    const safeCwd = existsSync(cwd) ? cwd : homedir()
    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: safeCwd,
        env: process.env as Record<string, string>,
      })
    } catch (err) {
      throw new Error(`Failed to spawn terminal: ${err}`)
    }
    outputBuffers.set(id, '')
    ptyProcess.onData(data => {
      appendBuffer(id, data)
      for (const wc of webContents.getAllWebContents()) {
        if (!wc.isDestroyed()) wc.send(IPC_CHANNELS.terminalData, id, data)
      }
    })
    terminals.set(id, ptyProcess)
    return id
  })

  // Returns buffered output for replay; does not create or kill anything.
  ipcMain.handle(IPC_CHANNELS.terminalAttach, (_e, id: string) => {
    return outputBuffers.get(id) ?? ''
  })

  ipcMain.handle(IPC_CHANNELS.terminalSendInput, (_e, id: string, data: string) => {
    terminals.get(id)?.write(data)
  })

  ipcMain.handle(IPC_CHANNELS.terminalResize, (_e, id: string, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows)
  })

  // Detach only — PTY keeps running.
  ipcMain.handle(IPC_CHANNELS.terminalDestroy, (_e, _id: string) => {
    // intentional no-op: panel close detaches, does not kill
  })

  // Actually terminates the PTY and clears state.
  ipcMain.handle(IPC_CHANNELS.terminalKill, (_e, id: string) => {
    try { terminals.get(id)?.kill() } catch {}
    terminals.delete(id)
    outputBuffers.delete(id)
  })
}
