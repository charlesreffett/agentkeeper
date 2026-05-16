import chokidar, { type FSWatcher } from 'chokidar'
import { webContents } from 'electron'
import path from 'node:path'
import { IPC_CHANNELS } from '../shared/ipc-contract.js'
import type { GitStatusChangedEvent, FsChangedEvent } from '../shared/ipc-contract.js'

interface WatchEntry {
  gitWatcher: FSWatcher
  fsWatcher: FSWatcher
  subscribers: Set<number>
  gitDebounceTimer: ReturnType<typeof setTimeout> | null
  fsDebounceTimer: ReturnType<typeof setTimeout> | null
}

const entries = new Map<string, WatchEntry>()

export function startWatching(projectPath: string, webContentsId: number): void {
  const existing = entries.get(projectPath)
  if (existing) {
    existing.subscribers.add(webContentsId)
    return
  }

  const gitWatcher = chokidar.watch(
    [
      path.join(projectPath, '.git', 'index'),
      path.join(projectPath, '.git', 'HEAD'),
      path.join(projectPath, '.git', 'refs'),
    ],
    { persistent: true, ignoreInitial: true, awaitWriteFinish: false },
  )

  const fsWatcher = chokidar.watch(projectPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\.git([/\\]|$)/,
      /(^|[/\\])node_modules([/\\]|$)/,
      /(^|[/\\])(dist|build|\.next|\.nuxt|out)([/\\]|$)/,
    ],
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    depth: 6,
  })

  const entry: WatchEntry = {
    gitWatcher,
    fsWatcher,
    subscribers: new Set([webContentsId]),
    gitDebounceTimer: null,
    fsDebounceTimer: null,
  }
  entries.set(projectPath, entry)

  gitWatcher.on('all', () => scheduleGitEmit(projectPath))
  fsWatcher.on('all', () => scheduleFsEmit(projectPath))
}

export function stopWatching(projectPath: string, webContentsId: number): void {
  const entry = entries.get(projectPath)
  if (!entry) return
  entry.subscribers.delete(webContentsId)
  if (entry.subscribers.size === 0) {
    closeEntry(projectPath, entry)
  }
}

export function removeSubscriber(webContentsId: number): void {
  for (const [projectPath, entry] of entries) {
    if (entry.subscribers.has(webContentsId)) {
      entry.subscribers.delete(webContentsId)
      if (entry.subscribers.size === 0) {
        closeEntry(projectPath, entry)
      }
    }
  }
}

export function stopAllWatchers(): void {
  for (const [projectPath, entry] of entries) {
    closeEntry(projectPath, entry)
  }
}

function closeEntry(projectPath: string, entry: WatchEntry): void {
  if (entry.gitDebounceTimer !== null) clearTimeout(entry.gitDebounceTimer)
  if (entry.fsDebounceTimer !== null) clearTimeout(entry.fsDebounceTimer)
  entry.gitWatcher.close()
  entry.fsWatcher.close()
  entries.delete(projectPath)
}

function scheduleGitEmit(projectPath: string): void {
  const entry = entries.get(projectPath)
  if (!entry) return
  if (entry.gitDebounceTimer !== null) clearTimeout(entry.gitDebounceTimer)
  entry.gitDebounceTimer = setTimeout(() => {
    entry.gitDebounceTimer = null
    emitToSubscribers(entry, IPC_CHANNELS.gitStatusChanged, { projectPath } as GitStatusChangedEvent)
  }, 250)
}

function scheduleFsEmit(projectPath: string): void {
  const entry = entries.get(projectPath)
  if (!entry) return
  if (entry.fsDebounceTimer !== null) clearTimeout(entry.fsDebounceTimer)
  entry.fsDebounceTimer = setTimeout(() => {
    entry.fsDebounceTimer = null
    emitToSubscribers(entry, IPC_CHANNELS.fsChanged, { projectPath } as FsChangedEvent)
  }, 400)
}

function emitToSubscribers(entry: WatchEntry, channel: string, payload: unknown): void {
  for (const id of entry.subscribers) {
    const wc = webContents.fromId(id)
    if (wc && !wc.isDestroyed()) {
      wc.send(channel, payload)
    } else {
      entry.subscribers.delete(id)
    }
  }
}
