import keytar from 'keytar'

const SERVICE = 'orchestral-ai'
const HARNESS_PREFIX = 'harness:'

export const SECRET_KEYS = {
  anthropicApiKey: 'anthropic-api-key',
} as const

export type SecretKey = (typeof SECRET_KEYS)[keyof typeof SECRET_KEYS]

export const secrets = {
  async get(key: SecretKey): Promise<string | null> {
    return keytar.getPassword(SERVICE, key)
  },
  async set(key: SecretKey, value: string): Promise<void> {
    await keytar.setPassword(SERVICE, key, value)
  },
  async has(key: SecretKey): Promise<boolean> {
    const v = await keytar.getPassword(SERVICE, key)
    return v !== null && v.length > 0
  },
  async delete(key: SecretKey): Promise<void> {
    await keytar.deletePassword(SERVICE, key)
  },
}

export const harnessSecrets = {
  get(harnessId: string, fieldId: string): Promise<string | null> {
    return keytar.getPassword(SERVICE, `${HARNESS_PREFIX}${harnessId}:${fieldId}`)
  },
  set(harnessId: string, fieldId: string, value: string): Promise<void> {
    return keytar.setPassword(SERVICE, `${HARNESS_PREFIX}${harnessId}:${fieldId}`, value)
  },
  async has(harnessId: string, fieldId: string): Promise<boolean> {
    return Boolean(await this.get(harnessId, fieldId))
  },
  async delete(harnessId: string, fieldId: string): Promise<void> {
    await keytar.deletePassword(SERVICE, `${HARNESS_PREFIX}${harnessId}:${fieldId}`)
  },
  async deleteAll(): Promise<void> {
    const entries = await keytar.findCredentials(SERVICE)
    await Promise.all(entries
      .filter((entry) => entry.account.startsWith(HARNESS_PREFIX))
      .map((entry) => keytar.deletePassword(SERVICE, entry.account)))
  },
}

export type ClaudeAuthResolution =
  | { type: 'api-key'; key: string }
  | { type: 'cli' }

/**
 * Determine which auth path to use for a Claude invocation.
 * Console users get a direct SDK call with their keychain key.
 * Pro/Max users get the subprocess path which picks up `claude login`.
 */
export async function resolveClaudeAuth(): Promise<ClaudeAuthResolution> {
  const key = await secrets.get(SECRET_KEYS.anthropicApiKey)
  if (key) return { type: 'api-key', key }
  return { type: 'cli' }
}

export function createPluginSecrets(pluginId: string): {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
} {
  const prefix = `plugin:${pluginId}:`
  return {
    async get(key) {
      return (await keytar.getPassword(SERVICE, `${prefix}${key}`)) ?? undefined
    },
    async set(key, value) {
      await keytar.setPassword(SERVICE, `${prefix}${key}`, value)
    },
    async delete(key) {
      await keytar.deletePassword(SERVICE, `${prefix}${key}`)
    },
  }
}
