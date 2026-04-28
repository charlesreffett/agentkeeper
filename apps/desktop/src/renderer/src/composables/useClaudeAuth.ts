import { ref } from 'vue'
import type { ClaudeAuthType } from '@shared/ipc-contract'

export function useClaudeAuth() {
  const authType = ref<ClaudeAuthType | null>(null)
  const needsApiKey = ref(false)

  async function checkAuth(): Promise<ClaudeAuthType> {
    const type = await window.agentkeeper.auth.status()
    authType.value = type
    return type
  }

  function handleAuthError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    if (err.message.includes('[API_KEY_MISSING]')) {
      needsApiKey.value = true
      return true
    }
    return false
  }

  return { authType, needsApiKey, checkAuth, handleAuthError }
}
