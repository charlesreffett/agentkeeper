import { z } from 'zod'

export type PluginPermission = 'workItems' | 'secrets' | 'commands' | 'sidebar' | 'background' | 'network'

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
  properties: z.record(JsonSchemaPropertySchema),
  required: z.array(z.string()).optional(),
})

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
  permissions: z.array(z.enum(['workItems', 'secrets', 'commands', 'sidebar', 'background', 'network'])).default([]),
  network: z.object({
    hosts: z.array(z.string()),
  }).optional(),
  settings_schema: SettingsSchemaSchema.optional(),
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
