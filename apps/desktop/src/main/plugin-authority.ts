import type { PluginManifest, PluginPermission } from '@agentkeeper/sdk'

export interface PluginAuthority {
  version: 1
  permissions: PluginPermission[]
  networkOrigins: string[]
  environmentNames: string[]
}

const unique = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort() as T[]

export function authorityFromManifest(manifest: PluginManifest): PluginAuthority {
  return {
    version: 1,
    permissions: unique(manifest.permissions),
    networkOrigins: unique(manifest.network?.hosts ?? []),
    environmentNames: unique(manifest.environment?.variables ?? []),
  }
}

export function serializeAuthority(authority: PluginAuthority): string {
  return JSON.stringify({
    version: 1,
    permissions: unique(authority.permissions),
    networkOrigins: unique(authority.networkOrigins),
    environmentNames: unique(authority.environmentNames),
  })
}

export function parseAuthority(raw: string): PluginAuthority {
  const value = JSON.parse(raw) as Record<string, unknown>
  const strings = (candidate: unknown): string[] => {
    if (!Array.isArray(candidate) || candidate.some(item => typeof item !== 'string')) throw new Error('Invalid plugin authority')
    return unique(candidate as string[])
  }
  return {
    version: 1,
    permissions: strings(value.permissions) as PluginPermission[],
    networkOrigins: strings(value.networkOrigins ?? value.networkHosts),
    environmentNames: strings(value.environmentNames ?? value.environmentVariables),
  }
}

export function authoritiesEqual(left: PluginAuthority, right: PluginAuthority): boolean {
  return serializeAuthority(left) === serializeAuthority(right)
}
