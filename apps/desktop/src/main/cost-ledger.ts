import fs from 'node:fs'
import path from 'node:path'

export interface CostEntry {
  key: string
  date: string        // YYYY-MM-DD
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  costUsd: number
  recordedAt: string  // ISO timestamp
}

interface LedgerData {
  entries: Record<string, CostEntry>
}

export interface DayTotal {
  date: string
  costUsd: number
  tokens: number
}

const LEDGER_FILE = 'cost-ledger.json'

let _userDataPath = ''
let _ledger: LedgerData = { entries: {} }
let _dirty = false
let _saveTimer: ReturnType<typeof setTimeout> | null = null

export function init(userDataPath: string): void {
  _userDataPath = userDataPath
  try {
    const raw = fs.readFileSync(path.join(userDataPath, LEDGER_FILE), 'utf8')
    const parsed = JSON.parse(raw) as LedgerData
    _ledger = { entries: parsed.entries ?? {} }
  } catch {
    _ledger = { entries: {} }
  }
}

export function hasEntry(key: string): boolean {
  return key in _ledger.entries
}

// No-op if key already recorded — the cost is frozen at computation time.
export function recordEntry(entry: CostEntry): void {
  if (hasEntry(entry.key)) return
  _ledger.entries[entry.key] = entry
  _dirty = true
  if (!_saveTimer) {
    _saveTimer = setTimeout(() => {
      _saveTimer = null
      if (!_dirty) return
      _dirty = false
      try {
        fs.writeFileSync(
          path.join(_userDataPath, LEDGER_FILE),
          JSON.stringify(_ledger),
          'utf8',
        )
      } catch (err) {
        console.error('[cost-ledger] save failed:', err)
      }
    }, 500)
  }
}

export function flush(): void {
  if (!_dirty) return
  if (_saveTimer !== null) { clearTimeout(_saveTimer); _saveTimer = null }
  _dirty = false
  try {
    fs.writeFileSync(path.join(_userDataPath, LEDGER_FILE), JSON.stringify(_ledger), 'utf8')
  } catch (err) {
    console.error('[cost-ledger] flush failed:', err)
  }
}

export function getDailySummary(): DayTotal[] {
  const days: Record<string, DayTotal> = {}
  for (const entry of Object.values(_ledger.entries)) {
    if (!days[entry.date]) days[entry.date] = { date: entry.date, costUsd: 0, tokens: 0 }
    days[entry.date]!.costUsd += entry.costUsd
    days[entry.date]!.tokens += entry.inputTokens + entry.outputTokens
  }
  return Object.values(days).sort((a, b) => a.date.localeCompare(b.date))
}
