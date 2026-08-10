import type { HarnessCapabilities } from '@agentkeeper/core'
import { getHarness, harnessRegistry } from './harness'

// Cached per harness for the app session. The static baseline is instant, but a
// harness may refine it via probeCapabilities() (e.g. a CLI-wrapping harness
// parsing `--help`), which can cost a subprocess — so resolve once and cache.
const cache = new Map<string, HarnessCapabilities>()
const inflight = new Map<string, Promise<HarnessCapabilities>>()

async function resolve(id: string): Promise<HarnessCapabilities> {
  const adapter = getHarness(id)
  const baseline = adapter.capabilities
  if (!adapter.probeCapabilities) return baseline
  try {
    return { ...baseline, ...(await adapter.probeCapabilities()) }
  } catch {
    return baseline
  }
}

export async function getCapabilities(harnessId?: string): Promise<HarnessCapabilities> {
  const id = getHarness(harnessId).id
  const cached = cache.get(id)
  if (cached) return cached

  const existing = inflight.get(id)
  if (existing) return existing

  const promise = resolve(id).then((caps) => {
    cache.set(id, caps)
    inflight.delete(id)
    return caps
  })
  inflight.set(id, promise)
  return promise
}

/** Warm every harness's capabilities at startup so the first UI read is instant
 *  and capability-gated controls render correctly on first paint. */
export function warmCapabilities(): void {
  for (const adapter of harnessRegistry.list()) {
    void getCapabilities(adapter.id).catch(() => { /* falls back to baseline */ })
  }
}
