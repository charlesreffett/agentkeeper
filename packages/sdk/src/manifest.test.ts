import { describe, expect, it } from 'vitest'
import { PluginManifestSchema, UpdateManifestSchema } from './manifest'

describe('plugin manifests', () => {
  it('accepts project-aware UI contributions', () => {
    const result = PluginManifestSchema.parse({
      schema_version: 1,
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      entry: 'dist/index.js',
      permissions: ['commands', 'projects', 'ui'],
      renderer: { entry: 'dist/renderer.js', views: ['dashboard'] },
      contributes: {
        navigation: [{ id: 'example', label: 'Example', route: 'dashboard' }],
        routes: [{ id: 'dashboard', path: 'dashboard', view: 'dashboard' }],
      },
    })
    expect(result.permissions).toContain('projects')
    expect(result.contributes?.routes[0]?.view).toBe('dashboard')
  })

  it('rejects routes that can escape the plugin namespace', () => {
    const result = PluginManifestSchema.safeParse({
      schema_version: 1,
      id: 'example',
      name: 'Example',
      version: '1.0.0',
      entry: 'dist/index.js',
      renderer: { entry: 'dist/renderer.js', views: ['dashboard'] },
      contributes: { routes: [{ id: 'bad', path: '../settings', view: 'dashboard' }] },
    })
    expect(result.success).toBe(false)
  })

  it('rejects unsafe identities and package entry paths', () => {
    const base = {
      schema_version: 1,
      name: 'Unsafe',
      version: '1.0.0',
      entry: 'dist/index.js',
    }
    expect(PluginManifestSchema.safeParse({ ...base, id: '../../escape' }).success).toBe(false)
    expect(PluginManifestSchema.safeParse({ ...base, id: 'safe', version: '1.0.0../../escape' }).success).toBe(false)
    expect(PluginManifestSchema.safeParse({ ...base, id: 'safe', entry: '../outside.js' }).success).toBe(false)
    expect(PluginManifestSchema.safeParse({ ...base, id: 'safe', entry: '/tmp/outside.js' }).success).toBe(false)
    expect(PluginManifestSchema.safeParse({
      ...base,
      id: 'safe',
      renderer: { entry: '..\\outside.js', views: ['main'] },
    }).success).toBe(false)
  })

  it('validates a release update feed', () => {
    expect(UpdateManifestSchema.parse({
      id: 'example',
      releases: [{
        version: '1.2.0',
        url: 'https://example.com/example-1.2.0.akp',
        sha256: 'a'.repeat(64),
      }],
    }).releases).toHaveLength(1)
  })

  it('accepts the high-risk native process permission', () => {
    const result = PluginManifestSchema.parse({
      schema_version: 1,
      id: 'native-tool',
      name: 'Native Tool',
      version: '1.0.0',
      entry: 'dist/index.js',
      permissions: ['nativeProcess'],
    })

    expect(result.permissions).toEqual(['nativeProcess'])
  })

  it('requires environment variables and permission together', () => {
    const base = {
      schema_version: 1,
      id: 'environment-tool',
      name: 'Environment Tool',
      version: '1.0.0',
      entry: 'dist/index.js',
    } as const

    expect(PluginManifestSchema.safeParse({
      ...base,
      permissions: ['environment'],
    }).success).toBe(false)
    expect(PluginManifestSchema.safeParse({
      ...base,
      environment: { variables: ['EXAMPLE_TOKEN'] },
    }).success).toBe(false)
    expect(PluginManifestSchema.safeParse({
      ...base,
      permissions: ['environment'],
      environment: { variables: ['EXAMPLE_TOKEN'] },
    }).success).toBe(true)
  })
})
