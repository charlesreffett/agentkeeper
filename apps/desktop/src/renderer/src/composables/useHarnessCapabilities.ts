import type { HarnessCapabilities } from '@shared/ipc-contract'
import { useHarnessList, useActiveHarness } from './useHarness'

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
