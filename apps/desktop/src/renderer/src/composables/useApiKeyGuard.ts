import { ref } from 'vue'

const API_KEY_MISSING_PREFIX = '[API_KEY_MISSING]'

export function useApiKeyGuard() {
  const apiKeyMissing = ref(false)

  async function ensureApiKey(): Promise<boolean> {
    const has = await window.agentkeeper.secrets.has('anthropicApiKey')
    if (!has) {
      apiKeyMissing.value = true
      return false
    }
    return true
  }

  function isApiKeyError(err: unknown): boolean {
    return err instanceof Error && err.message.startsWith(API_KEY_MISSING_PREFIX)
  }

  function handleApiKeyError(err: unknown): boolean {
    if (isApiKeyError(err)) {
      apiKeyMissing.value = true
      return true
    }
    return false
  }

  return { apiKeyMissing, ensureApiKey, handleApiKeyError }
}
