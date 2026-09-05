import type { HarnessAdapter } from '@agentkeeper/core'
import os from 'node:os'
import path from 'node:path'
import { settingsStore } from '../settings'
import { harnessSecrets } from '../secrets'

/** Resolve a configured path field with the same precedence used for harness
 * subprocess environments: saved settings, process environment, fallback. */
export function resolveHarnessPath(
  adapter: HarnessAdapter,
  fieldId: string,
  fallback: string,
): string {
  const field = adapter.configuration?.fields.find((candidate) => candidate.id === fieldId)
  const saved = settingsStore.get().harnessConfig?.[adapter.id]?.[fieldId]
  const envName = field && 'env' in field ? field.env : undefined
  const raw = typeof saved === 'string' && saved
    ? saved
    : envName && process.env[envName]
      ? process.env[envName]!
      : fallback
  return raw.startsWith('~') ? path.join(os.homedir(), raw.slice(1)) : path.resolve(raw)
}

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
