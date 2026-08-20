import { webContents } from 'electron'
import { getHarness } from './harness'
import type { AvailableModel, HarnessModelSnapshot } from '../shared/ipc-contract'
import { IPC_CHANNELS } from '../shared/ipc-contract'
import { sanitizeCustomModel } from '@agentkeeper/core'
import { settingsStore } from './settings'

const snapshots = new Map<string, HarnessModelSnapshot>()
const inflight = new Map<string, Promise<HarnessModelSnapshot>>()

function harnessIdFor(harnessId?: string): string {
  return getHarness(harnessId).id
}

function broadcast(snapshot: HarnessModelSnapshot): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(IPC_CHANNELS.modelsChanged, snapshot)
  }
}

async function discover(id: string): Promise<AvailableModel[]> {
  const adapter = getHarness(id)
  const discovered = await adapter.getSupportedModels()
  if (!adapter.capabilities.customModels) return discovered
  const seen = new Set(discovered.map((model) => model.value))
  const custom = (settingsStore.get().customModels?.[id] ?? [])
    .map((value) => value.trim())
    .map((value) => sanitizeCustomModel(value))
    .filter((value): value is string => !!value && !seen.has(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .map((value) => ({ value, label: value, resolvedModel: value, isCustom: true }))
  return [...discovered, ...custom]
}

function startRefresh(id: string): Promise<HarnessModelSnapshot> {
  const existing = inflight.get(id)
  if (existing) return existing

  const previous = snapshots.get(id)
  if (previous) {
    const refreshing = { ...previous, status: 'refreshing' as const, error: undefined }
    snapshots.set(id, refreshing)
    broadcast(refreshing)
  }

  const promise = discover(id)
    .then((models) => {
      const snapshot: HarnessModelSnapshot = { harnessId: id, models, status: 'ready', refreshedAt: Date.now() }
      snapshots.set(id, snapshot)
      broadcast(snapshot)
      return snapshot
    })
    .catch((err: unknown) => {
      const snapshot: HarnessModelSnapshot = {
        harnessId: id,
        models: previous?.models ?? [],
        status: 'error',
        refreshedAt: previous?.refreshedAt ?? null,
        error: err instanceof Error ? err.message : String(err),
      }
      snapshots.set(id, snapshot)
      broadcast(snapshot)
      return snapshot
    })
    .finally(() => inflight.delete(id))
  inflight.set(id, promise)
  return promise
}

export async function getAvailableModels(harnessId?: string): Promise<HarnessModelSnapshot> {
  const id = harnessIdFor(harnessId)
  const snapshot = snapshots.get(id)
  if (snapshot) return snapshot.status === 'ready' ? { ...snapshot, status: 'cached' } : snapshot
  return startRefresh(id)
}

export function refreshAvailableModels(harnessId?: string): Promise<HarnessModelSnapshot> {
  return startRefresh(harnessIdFor(harnessId))
}

export function invalidateAvailableModels(harnessId?: string): void {
  const id = harnessIdFor(harnessId)
  const previous = snapshots.get(id)
  if (previous) snapshots.set(id, { ...previous, status: 'cached', refreshedAt: null })
}

/** Harness-resolved default model. Never a hardcoded version — the harness
 *  reports which model is default (`isDefault`); the `'default'` alias is the
 *  fallback when the list is unavailable, and itself resolves at run time. */
export async function getDefaultModel(harnessId?: string): Promise<string> {
  const { models } = await getAvailableModels(harnessId)
  const value = models.find((m) => m.isDefault)?.value
  // Defensive: a cached value that fails the model guard falls back to the
  // `default` alias, which adapters resolve to a reachable concrete model.
  return value !== undefined && sanitizeCustomModel(value) !== null ? value : 'default'
}

/** Validate a free-text model id against the harness's cached live list when
 *  one is available, otherwise against the pattern guard. Returns the model
 *  when acceptable, null when not. */
export async function validateCustomModel(harnessId: string | undefined, model: string): Promise<string | null> {
  if (sanitizeCustomModel(model) === null) return null
  const id = harnessIdFor(harnessId)
  const snapshot = snapshots.get(id)
  if (snapshot?.models.some((m) => m.value === model)) return model
  if (!getHarness(id).capabilities.customModels && snapshot?.models.length) return null
  return model
}

/** Warm the default harness cache at startup so the first picker open is instant. */
export function warmAvailableModels(): void {
  void getAvailableModels().catch(() => { /* error is captured in the cached result */ })
}

export function resetModelSnapshotsForTest(): void {
  snapshots.clear()
  inflight.clear()
}
