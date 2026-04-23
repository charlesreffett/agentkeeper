import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../shared/ipc-contract'

const DEFAULTS: AppSettings = {
  defaultModel: 'claude-sonnet-4-6',
  defaultEffort: 'medium',
}

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function read(): AppSettings {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function write(data: AppSettings): void {
  const f = filePath()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(data, null, 2))
}

export const settingsStore = {
  get(): AppSettings {
    return read()
  },
  set(partial: Partial<AppSettings>): AppSettings {
    const next = { ...read(), ...partial }
    write(next)
    return next
  },
}
