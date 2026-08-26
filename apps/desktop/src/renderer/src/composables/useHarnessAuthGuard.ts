import { ref } from 'vue'
import type { HarnessAuthInfo } from '@shared/ipc-contract'

export function useHarnessAuthGuard() {
  const authType = ref<string | null>(null)
  const needsApiKey = ref(false)

  async function checkAuth(): Promise<string> {
    const [active, states] = await Promise.all([
      window.agentkeeper.harness.getActive(),
      window.agentkeeper.harness.auth(),
    ])
    const state: HarnessAuthInfo | undefined = states.find((candidate) => candidate.id === active.id)
    const type = state?.type ?? 'unknown'
    authType.value = type
    return type
  }

  function handleAuthError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    if (/API_KEY_MISSING|not authenticated|not logged in|oauth.*expired/i.test(err.message)) {
      needsApiKey.value = true
      return true
    }
    return false
  }

  return { authType, needsApiKey, checkAuth, handleAuthError }
}
