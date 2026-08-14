import type { AppSettings } from '@shared/ipc-contract'

/** Default model for a new draft on a harness: per-harness last-used memory
 *  wins, else the global default. Harness ids are resolved lazily so an
 *  undefined id falls back to the active harness. */
export function defaultModelFor(settings: AppSettings, harnessId?: string): string {
  const effective = harnessId ?? settings.harnessId
  return (effective ? settings.lastUsedModels?.[effective] : undefined) ?? settings.defaultModel
}

/** Remember a model pick per harness. A session pick records against the
 *  session's harness so browsing another harness (or its model) never leaks
 *  into the default harness's next draft. */
export async function rememberModel(model: string, harnessId?: string): Promise<void> {
  if (!model) return
  const settings = await window.agentkeeper.settings.get()
  const effective = harnessId ?? settings.harnessId
  if (!effective) return
  const next = { ...(settings.lastUsedModels ?? {}), [effective]: model }
  void window.agentkeeper.settings.set({ lastUsedModels: next })
}
