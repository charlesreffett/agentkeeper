import type { PluginRecord, WorkItem, WorkItemReference } from '@shared/ipc-contract'
import { ref, toValue, watch, type MaybeRefOrGetter } from 'vue'

export type ProviderWorkItemState =
  | { status: 'loading' }
  | { status: 'available'; item: WorkItem }
  | { status: 'unavailable' }

export const PROVIDER_UNAVAILABLE_LABEL = 'Provider not available'

export function workItemReferenceKey(reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>): string {
  return `${reference.sourceId}\u0000${reference.itemId}`
}

export async function refreshProviderWorkItems(
  references: readonly WorkItemReference[],
  listPlugins: () => Promise<PluginRecord[]>,
  getWorkItem: (reference: Pick<WorkItemReference, 'sourceId' | 'itemId'>) => Promise<WorkItem | undefined>,
): Promise<Map<string, ProviderWorkItemState>> {
  const unique = new Map(references.map(reference => [workItemReferenceKey(reference), reference]))
  if (unique.size === 0) return new Map()

  let plugins: PluginRecord[]
  try {
    plugins = await listPlugins()
  } catch {
    return new Map([...unique.keys()].map(key => [key, { status: 'unavailable' }]))
  }

  const availableProviders = new Set(
    plugins.filter(plugin => plugin.enabled && plugin.status === 'active').map(plugin => plugin.id),
  )
  const entries: Array<[string, ProviderWorkItemState]> = await Promise.all([...unique.entries()].map(async ([key, reference]): Promise<[string, ProviderWorkItemState]> => {
    if (!availableProviders.has(reference.sourceId)) {
      return [key, { status: 'unavailable' }]
    }
    try {
      const item = await getWorkItem(reference)
      return [key, item ? { status: 'available', item } : { status: 'unavailable' }]
    } catch {
      return [key, { status: 'unavailable' }]
    }
  }))
  return new Map(entries)
}

export function useProviderWorkItems(references: MaybeRefOrGetter<readonly WorkItemReference[]>) {
  const states = ref(new Map<string, ProviderWorkItemState>())
  let generation = 0

  watch(
    () => toValue(references),
    async (nextReferences) => {
      const currentGeneration = ++generation
      states.value = new Map(nextReferences.map(reference => [
        workItemReferenceKey(reference),
        { status: 'loading' } as ProviderWorkItemState,
      ]))
      const refreshed = await refreshProviderWorkItems(
        nextReferences,
        () => window.agentkeeper.plugins.list(),
        reference => window.agentkeeper.workItems.get(reference),
      )
      if (currentGeneration === generation) states.value = refreshed
    },
    { immediate: true },
  )

  return {
    stateFor(reference: WorkItemReference | null | undefined): ProviderWorkItemState | undefined {
      return reference ? states.value.get(workItemReferenceKey(reference)) : undefined
    },
  }
}
