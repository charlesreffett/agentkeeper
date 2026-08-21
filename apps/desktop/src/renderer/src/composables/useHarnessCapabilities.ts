import type { HarnessCapabilities } from '@shared/ipc-contract'
import { useHarnessList, useActiveHarness } from './useHarness'
import type { LiveSessionStatus } from '@shared/ipc-contract'

export interface ModelSelectionState {
  enabled: boolean
  reason?: string
}

export function resolveModelSelectionState(
  mutability: HarnessCapabilities['modelSelection'] | undefined,
  isDraft: boolean,
  status?: LiveSessionStatus,
): ModelSelectionState {
  if (isDraft) return { enabled: true }
  if (mutability === 'draft-only') return { enabled: false, reason: 'This harness fixes the model when the session starts.' }
  if (status === 'running' || status === 'starting') {
    return mutability === 'turn'
      ? { enabled: true }
      : { enabled: false, reason: 'Wait for the current turn to finish before changing models.' }
  }
  if (status === 'idle' || status === 'suspended') return { enabled: true }
  return { enabled: false, reason: 'Model selection is unavailable in this session state.' }
}

/** Read a harness's resolved capabilities in the renderer. Defaults to the
 *  active harness when no id is given. Capability lookups are optimistic while
 *  the list loads (undefined → treated as capable) so controls don't flicker
 *  disabled; the main-process backstop enforces the real constraint. */
export function useHarnessCapabilities() {
  const { data: harnesses } = useHarnessList()
  const { data: active } = useActiveHarness()

  function capabilities(harnessId?: string): HarnessCapabilities | undefined {
    const id = harnessId ?? active.value?.id
    return harnesses.value?.find((h) => h.id === id)?.capabilities
  }

  const agenciesCapable = (harnessId?: string): boolean =>
    capabilities(harnessId)?.agencies ?? true

  return { capabilities, agenciesCapable }
}
