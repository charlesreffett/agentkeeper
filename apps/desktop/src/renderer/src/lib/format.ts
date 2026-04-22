const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms
  if (diff < 0) return 'just now'
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) {
    const m = Math.round(diff / MINUTE)
    return `${m}m ago`
  }
  if (diff < DAY) {
    const h = Math.round(diff / HOUR)
    return `${h}h ago`
  }
  if (diff < WEEK) {
    const d = Math.round(diff / DAY)
    return `${d}d ago`
  }
  return new Date(ms).toLocaleDateString()
}

export function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function shortModel(model: string | null): string | null {
  if (!model) return null
  // 'claude-sonnet-4-6' → 'sonnet 4.6', 'claude-opus-4-7' → 'opus 4.7'
  const m = model.match(/^claude-([a-z]+)-(\d+)-(\d+)/)
  if (m) return `${m[1]} ${m[2]}.${m[3]}`
  return model
}
