import keytar from 'keytar'

const SERVICE = 'orchestral-ai'

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

export async function requireApiKey(): Promise<string> {
  const key = await secrets.get(SECRET_KEYS.anthropicApiKey)
  if (!key) throw new Error('[API_KEY_MISSING] No Anthropic API key configured. Add one in Settings → API Key.')
  return key
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
