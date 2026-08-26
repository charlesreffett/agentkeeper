import type { HarnessAdapter } from '@agentkeeper/core'
import os from 'node:os'
import path from 'node:path'
import { settingsStore } from '../settings'
import { harnessSecrets } from '../secrets'

export async function resolveHarnessEnvironment(
  adapter: HarnessAdapter,
  extra?: Record<string, string>,
): Promise<Record<string, string>> {
  const values = settingsStore.get().harnessConfig?.[adapter.id] ?? {}
  const environment: Record<string, string> = { ...(extra ?? {}) }
  for (const field of adapter.configuration?.fields ?? []) {
    const value = field.type === 'secret'
      ? await harnessSecrets.get(adapter.id, field.id)
      : values[field.id]
    const env = 'env' in field ? field.env : undefined
    if (typeof value === 'boolean') {
      if (env) environment[env] = value ? '1' : '0'
      continue
    }
    if (typeof value !== 'string' || !value) continue
    const resolved = field.type === 'path' && value.startsWith('~')
      ? path.join(os.homedir(), value.slice(1))
      : value
    if (env) environment[env] = resolved
  }
  return environment
}
