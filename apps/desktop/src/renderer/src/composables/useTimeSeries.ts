import { ref, onScopeDispose } from 'vue'
import type { Ref } from 'vue'

interface TimeSeriesOptions {
  /** Number of data points to retain. Default: 20 */
  maxPoints?: number
  /** Sampling interval in ms. Default: 60_000 (1 minute) */
  intervalMs?: number
}

export function useTimeSeries(
  getValue: () => number,
  options: TimeSeriesOptions = {},
): Ref<number[]> {
  const maxPoints = options.maxPoints ?? 20
  const intervalMs = options.intervalMs ?? 60_000

  const data = ref<number[]>([getValue()])

  const id = setInterval(() => {
    data.value = [...data.value.slice(-(maxPoints - 1)), getValue()]
  }, intervalMs)

  onScopeDispose(() => clearInterval(id))

  return data
}
