export const PLUGIN_HOST_LIMITS = {
  messagesPerSecond: 500,
  backgroundTasks: 64,
  eventListeners: 64,
  commands: 256,
  uiContributions: 128,
  pendingRequests: 128,
  storageEntries: 1_000,
  storageTotalBytes: 10 * 1024 * 1024,
  minimumIntervalMs: 1_000,
  maximumTimerMs: 7 * 24 * 60 * 60 * 1_000,
} as const

export class PluginMessageRateLimiter {
  private windowStartedAt: number
  private count = 0

  constructor(
    private readonly maximum: number = PLUGIN_HOST_LIMITS.messagesPerSecond,
    private readonly windowMs: number = 1_000,
    now: number = Date.now(),
  ) {
    this.windowStartedAt = now
  }

  accept(now = Date.now()): boolean {
    if (now < this.windowStartedAt || now - this.windowStartedAt >= this.windowMs) {
      this.windowStartedAt = now
      this.count = 0
    }
    this.count++
    return this.count <= this.maximum
  }
}

export function assertResourceCapacity(kind: string, current: number, maximum: number): void {
  if (current >= maximum) throw new Error(`Plugin ${kind} limit reached (${maximum})`)
}

export function assertBackgroundDelay(kind: 'interval' | 'delay', milliseconds: number): void {
  if (!Number.isSafeInteger(milliseconds)) throw new Error(`Background ${kind} must be a safe integer`)
  const minimum = kind === 'interval' ? PLUGIN_HOST_LIMITS.minimumIntervalMs : 0
  if (milliseconds < minimum || milliseconds > PLUGIN_HOST_LIMITS.maximumTimerMs) {
    throw new Error(`Background ${kind} must be between ${minimum} and ${PLUGIN_HOST_LIMITS.maximumTimerMs}ms`)
  }
}
