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
