import { describe, expect, it } from 'vitest'
import {
  assertBackgroundDelay,
  assertResourceCapacity,
  PluginMessageRateLimiter,
} from './plugin-protocol-policy'

describe('plugin host protocol policy', () => {
  it('rejects a message flood and resets only after the complete window', () => {
    const limiter = new PluginMessageRateLimiter(2, 1_000, 10_000)
    expect(limiter.accept(10_000)).toBe(true)
    expect(limiter.accept(10_999)).toBe(true)
    expect(limiter.accept(10_999)).toBe(false)
    expect(limiter.accept(11_000)).toBe(true)
  })

  it('handles a clock moving backwards without permanently locking a plugin', () => {
    const limiter = new PluginMessageRateLimiter(1, 1_000, 10_000)
    expect(limiter.accept(10_000)).toBe(true)
    expect(limiter.accept(9_000)).toBe(true)
  })

  it('bounds repeating and one-shot timers', () => {
    expect(() => assertBackgroundDelay('interval', 999)).toThrow('between 1000')
    expect(() => assertBackgroundDelay('interval', 1_000)).not.toThrow()
    expect(() => assertBackgroundDelay('delay', 0)).not.toThrow()
    expect(() => assertBackgroundDelay('delay', Number.MAX_SAFE_INTEGER)).toThrow()
  })

  it('rejects resources after their per-plugin quota is full', () => {
    expect(() => assertResourceCapacity('timer', 63, 64)).not.toThrow()
    expect(() => assertResourceCapacity('timer', 64, 64)).toThrow('limit reached')
  })
})
