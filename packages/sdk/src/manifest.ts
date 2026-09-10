import { z } from 'zod'
import semver from 'semver'

export type PluginPermission = 'workItems' | 'secrets' | 'commands' | 'ui' | 'background' | 'network' | 'projects' | 'nativeProcess' | 'environment'

const displayString = z.string().max(2_048).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'control characters are not allowed')
const securityId = (max = 128) => z.string().min(1).max(max)
  .refine(value => value === value.normalize('NFC'), 'must use NFC normalization')
  .refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'control characters are not allowed')

const JsonSchemaPropertySchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  title: z.string().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.unknown().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.unknown()).max(256).optional(),
}).strict()

const SettingsSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), JsonSchemaPropertySchema).superRefine((value, ctx) => {
    const keys = Object.keys(value)
    if (keys.length > 256) ctx.addIssue({ code: 'custom', message: 'too many settings fields' })
    for (const key of keys) if (['__proto__', 'prototype', 'constructor'].includes(key)) ctx.addIssue({ code: 'custom', message: `reserved settings key: ${key}` })
  }),
  required: z.array(securityId(256)).max(256).optional(),
}).strict()

const PluginRouteSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1).regex(/^[a-z0-9][a-z0-9/_-]*$/),
  view: z.string().min(1),
}).strict()

const PluginNavigationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  route: z.string().min(1),
  order: z.number().optional(),
}).strict()

const PluginSettingsPageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  route: z.string().min(1),
  group: z.enum(['Settings', 'Integrations', 'System']).default('Integrations'),
}).strict()

const PluginContributionsSchema = z.object({
  routes: z.array(PluginRouteSchema).max(128).default([]),
  navigation: z.array(PluginNavigationSchema).max(128).default([]),
  settings: z.array(PluginSettingsPageSchema).max(128).default([]),
}).strict().optional()

const PluginRendererSchema = z.object({
  entry: z.string().min(1).refine(isSafePackagePath, 'must be a relative path without traversal'),
  views: z.array(securityId()).min(1).max(128),
}).strict().optional()

function isSafePackagePath(value: string): boolean {
  return !value.startsWith('/') && !value.includes('\\') && value
    .split('/')
    .every(part => part.length > 0 && part !== '.' && part !== '..')
}

const HttpsUrlSchema = z.string().url().refine((value) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}, 'must use HTTPS')

function isCanonicalDnsName(value: string): boolean {
  return value.length <= 253 && value.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
  )
}

function isLoopbackHost(value: string): boolean {
  if (value === 'localhost' || value === '[::1]') return true
  const parts = value.split('.')
  return parts.length === 4
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && parts[0] === '127'
}

export interface ParsedNetworkOriginPattern {
  scheme: 'http:' | 'https:'
  hostname: string
  port: string
  wildcard: boolean
}

/** Parse a canonical origin grant: scheme + hostname pattern + optional explicit port. */
export function parseNetworkOriginPattern(value: string): ParsedNetworkOriginPattern | null {
  if (value !== value.normalize('NFC') || value !== value.toLowerCase()) return null
  const match = /^(https?):\/\/([^/:?#]+|\[[0-9a-f:.]+\])(?::(\d{1,5}))?$/.exec(value)
  if (!match) return null
  const scheme = match[1]!
  const host = match[2]!
  const port = match[3]
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65_535 || String(Number(port)) !== port)) return null

  if (host === '*') return scheme === 'https'
    ? { scheme: 'https:', hostname: '*', port: port ?? '443', wildcard: true }
    : null
  if (host.startsWith('*.')) {
    const suffix = host.slice(2)
    return scheme === 'https' && suffix.includes('.') && isCanonicalDnsName(suffix)
      ? { scheme: 'https:', hostname: suffix, port: port ?? '443', wildcard: true }
      : null
  }

  let canonicalHost: string
  try { canonicalHost = new URL(`https://${host}`).hostname } catch { return null }
  if (canonicalHost !== host) return null // Reject Unicode, unusual IP spellings, and trailing dots.
  const isIpOrLocal = isLoopbackHost(host) || /^\d+(?:\.\d+){3}$/.test(host) || host.startsWith('[')
  if (!isIpOrLocal && !isCanonicalDnsName(host)) return null
  if (scheme !== 'https' && !isLoopbackHost(host)) return null
  const parsedScheme = `${scheme}:` as 'http:' | 'https:'
  return {
    scheme: parsedScheme,
    hostname: host,
    port: port ?? (parsedScheme === 'https:' ? '443' : '80'),
    wildcard: false,
  }
}

export function isNetworkOriginAllowed(patterns: readonly string[], targetValue: string | URL): boolean {
  let target: URL
  try { target = typeof targetValue === 'string' ? new URL(targetValue) : targetValue } catch { return false }
  if (target.username || target.password || (target.protocol !== 'https:' && target.protocol !== 'http:')) return false
  const targetPort = target.port || (target.protocol === 'https:' ? '443' : '80')
  return patterns.some((value) => {
    const pattern = parseNetworkOriginPattern(value)
    if (!pattern || pattern.scheme !== target.protocol || pattern.port !== targetPort) return false
    if (pattern.hostname === '*') return true
    return pattern.wildcard
      ? target.hostname === pattern.hostname || target.hostname.endsWith(`.${pattern.hostname}`)
      : target.hostname === pattern.hostname
  })
}

const NetworkOriginPatternSchema = z.string().refine(
  value => parseNetworkOriginPattern(value) !== null,
  'must be a canonical HTTP(S) origin pattern without a path (HTTP is limited to loopback)',
)

export const PluginManifestSchema = z.object({
  schema_version: z.literal(1),
  id: securityId().refine(value => /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(value), 'invalid plugin ID'),
  name: z.string().min(1).max(2_048).refine(value => !/[\u0000-\u001f\u007f]/.test(value), 'control characters are not allowed'),
  version: securityId().refine(value => semver.valid(value) !== null, 'invalid semantic version'),
  entry: z.string().min(1).max(2_048).refine(isSafePackagePath, 'must be a relative path without traversal'),
  icon: z.string().max(2_048).refine(value => isSafePackagePath(value) && /\.(?:png|jpe?g|webp)$/i.test(value), 'must be a package-relative PNG, JPEG, or WebP path').optional(),
  description: displayString.optional(),
  author: displayString.optional(),
  license: displayString.optional(),
  keywords: z.array(displayString).max(128).optional(),
  homepage_url: z.string().url().max(2_048).optional(),
  min_app_version: securityId().refine(value => semver.valid(value) !== null, 'invalid semantic version').optional(),
  activation_events: z.array(securityId(256)).max(64).default(['onStartup']),
  permissions: z.array(z.enum(['workItems', 'secrets', 'commands', 'ui', 'background', 'network', 'projects', 'nativeProcess', 'environment'])).max(9).default([]),
  environment: z.object({
    variables: z.array(z.string().max(128).regex(/^[A-Z_][A-Z0-9_]*$/)).max(128),
  }).strict().optional(),
  network: z.object({
    hosts: z.array(NetworkOriginPatternSchema).min(1).max(128),
  }).strict().optional(),
  settings_schema: SettingsSchemaSchema.optional(),
  renderer: PluginRendererSchema,
  contributes: PluginContributionsSchema,
  update_url: HttpsUrlSchema.optional(),
}).strict().superRefine((manifest, ctx) => {
  for (const [name, values] of [['permissions', manifest.permissions], ['network.hosts', manifest.network?.hosts ?? []], ['environment.variables', manifest.environment?.variables ?? []]] as const) {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', path: name.split('.'), message: 'duplicate entries are not allowed' })
  }
  const hasPermission = manifest.permissions.includes('environment')
  const hasVariables = Boolean(manifest.environment?.variables.length)
  if (hasPermission !== hasVariables) {
    ctx.addIssue({
      code: 'custom',
      path: ['environment'],
      message: 'environment permission and declared variables must be provided together',
    })
  }
  const hasNetworkPermission = manifest.permissions.includes('network')
  const hasNetworkHosts = Boolean(manifest.network?.hosts.length)
  if (hasNetworkPermission !== hasNetworkHosts) {
    ctx.addIssue({
      code: 'custom',
      path: ['network'],
      message: 'network permission and one or more origin patterns must be provided together',
    })
  }
  const routeIds = new Set(manifest.contributes?.routes.map(route => route.id) ?? [])
  const views = new Set(manifest.renderer?.views ?? [])
  for (const route of manifest.contributes?.routes ?? []) if (!views.has(route.view)) ctx.addIssue({ code: 'custom', path: ['contributes', 'routes'], message: `unknown renderer view: ${route.view}` })
  for (const route of [...(manifest.contributes?.navigation ?? []), ...(manifest.contributes?.settings ?? [])]) if (!routeIds.has(route.route)) ctx.addIssue({ code: 'custom', path: ['contributes'], message: `unknown route: ${route.route}` })
  if ((manifest.renderer || manifest.contributes) && !manifest.permissions.includes('ui')) ctx.addIssue({ code: 'custom', path: ['permissions'], message: 'UI declarations require ui permission' })
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

/** Whether an AgentKeeper host version satisfies a plugin or release minimum. */
export function satisfiesMinimumAppVersion(appVersion: string, minimumAppVersion?: string): boolean {
  if (!minimumAppVersion) return true
  return semver.valid(appVersion) !== null
    && semver.valid(minimumAppVersion) !== null
    && semver.gte(appVersion, minimumAppVersion)
}

const UpdateReleaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
  url: HttpsUrlSchema,
  sha256: z.string().regex(/^[0-9a-fA-F]{64}$/),
  min_app_version: z.string().optional(),
  release_notes: z.string().optional(),
}).strict()

export const UpdateManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/),
  releases: z.array(UpdateReleaseSchema),
}).strict()

export type UpdateRelease = z.infer<typeof UpdateReleaseSchema>
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>
