import { z } from 'zod'

export type PluginPermission = 'workItems' | 'secrets' | 'commands' | 'ui' | 'background' | 'network'

const JsonSchemaPropertySchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  title: z.string().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  default: z.unknown().optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  enum: z.array(z.unknown()).optional(),
})

const SettingsSchemaSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), JsonSchemaPropertySchema),
  required: z.array(z.string()).optional(),
})

const PluginRouteSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1).regex(/^[a-z0-9][a-z0-9/_-]*$/),
  view: z.string().min(1),
})

const PluginNavigationSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  route: z.string().min(1),
  order: z.number().optional(),
})

const PluginSettingsPageSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  icon: z.string().optional(),
  route: z.string().min(1),
  group: z.enum(['Settings', 'Integrations', 'System']).default('Integrations'),
})

const PluginContributionsSchema = z.object({
  routes: z.array(PluginRouteSchema).default([]),
  navigation: z.array(PluginNavigationSchema).default([]),
  settings: z.array(PluginSettingsPageSchema).default([]),
}).optional()

const PluginRendererSchema = z.object({
  entry: z.string().min(1),
  views: z.array(z.string().min(1)).min(1),
}).optional()

export const PluginManifestSchema = z.object({
  schema_version: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  entry: z.string(),
  icon: z.string().optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  license: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  homepage_url: z.string().url().optional(),
  min_app_version: z.string().optional(),
  activation_events: z.array(z.string()).default(['onStartup']),
  permissions: z.array(z.enum(['workItems', 'secrets', 'commands', 'ui', 'background', 'network'])).default([]),
  network: z.object({
    hosts: z.array(z.string()),
  }).optional(),
  settings_schema: SettingsSchemaSchema.optional(),
  renderer: PluginRendererSchema,
  contributes: PluginContributionsSchema,
  update_url: z.string().url().optional(),
})

export type PluginManifest = z.infer<typeof PluginManifestSchema>

const UpdateReleaseSchema = z.object({
  version: z.string(),
  url: z.string().url(),
  sha256: z.string(),
  min_app_version: z.string().optional(),
  release_notes: z.string().optional(),
})

export const UpdateManifestSchema = z.object({
  id: z.string(),
  releases: z.array(UpdateReleaseSchema),
})

export type UpdateRelease = z.infer<typeof UpdateReleaseSchema>
export type UpdateManifest = z.infer<typeof UpdateManifestSchema>
