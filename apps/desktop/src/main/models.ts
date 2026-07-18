import { getHarness } from './harness'
import type { ModelsListResult } from '../shared/ipc-contract'

// Cached per harness for the app session. The harness list is account/plan
// dependent and costs a subprocess spin-up, so it is fetched eagerly at startup
// and only re-fetched on explicit refresh.
const cache = new Map<string, ModelsListResult>()
const inflight = new Map<string, Promise<ModelsListResult>>()

function harnessIdFor(harnessId?: string): string {
  return getHarness(harnessId).id
}

async function fetchModels(harnessId: string): Promise<ModelsListResult> {
  try {
    const models = await getHarness(harnessId).getSupportedModels()
    return { harnessId, models }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { harnessId, models: [], error: message }
  }
}

export async function getAvailableModels(harnessId?: string): Promise<ModelsListResult> {
  const id = harnessIdFor(harnessId)
  const cached = cache.get(id)
  if (cached && !cached.error) return cached

  const existing = inflight.get(id)
  if (existing) return existing

  const promise = fetchModels(id).then((result) => {
    cache.set(id, result)
    inflight.delete(id)
    return result
  })
  inflight.set(id, promise)
  return promise
}

export async function refreshAvailableModels(harnessId?: string): Promise<ModelsListResult> {
  const id = harnessIdFor(harnessId)
  cache.delete(id)
  inflight.delete(id)
  return getAvailableModels(id)
}

/** Harness-resolved default model. Never a hardcoded version — the harness
 *  reports which model is default (`isDefault`); the `'default'` alias is the
 *  fallback when the list is unavailable, and itself resolves at run time. */
export async function getDefaultModel(harnessId?: string): Promise<string> {
  const { models } = await getAvailableModels(harnessId)
  return models.find((m) => m.isDefault)?.value ?? 'default'
}

/** Warm the default harness cache at startup so the first picker open is instant. */
export function warmAvailableModels(): void {
  void getAvailableModels().catch(() => { /* error is captured in the cached result */ })
}
