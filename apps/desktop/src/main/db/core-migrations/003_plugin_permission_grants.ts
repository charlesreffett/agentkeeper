import { defineMigration } from './Migration'

const checksumSource = `
plugin_registry: persist the user-approved capability grant independently from the mutable manifest
plugin_registry: record when an updated plugin requires permission review before it can run
`

interface ManifestAuthority {
  version: 1
  permissions: string[]
  networkHosts: string[]
  environmentVariables: string[]
}

function authorityFromManifest(value: unknown): ManifestAuthority {
  const manifest = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const network = manifest.network && typeof manifest.network === 'object'
    ? manifest.network as Record<string, unknown>
    : {}
  const environment = manifest.environment && typeof manifest.environment === 'object'
    ? manifest.environment as Record<string, unknown>
    : {}
  const strings = (candidate: unknown): string[] => Array.isArray(candidate)
    ? [...new Set(candidate.filter((item): item is string => typeof item === 'string'))].sort()
    : []
  return {
    version: 1,
    permissions: strings(manifest.permissions),
    networkHosts: strings(network.hosts),
    environmentVariables: strings(environment.variables),
  }
}

export default defineMigration({
  id: 3,
  name: 'plugin-permission-grants',
  revision: 1,
  checksumSource,
  up(schema) {
    schema.alterTable('plugin_registry', (table) => {
      table.text('granted_authority').notNull().default('{"permissions":[],"networkHosts":[],"environmentVariables":[]}')
      table.integer('action_required').notNull().default(0)
    })

    const rows = schema.prepare('SELECT id, source, manifest FROM plugin_registry').all() as Array<{ id: string; source: string; manifest: string }>
    const updateBundled = schema.prepare('UPDATE plugin_registry SET granted_authority = ? WHERE id = ?')
    const requireReview = schema.prepare('UPDATE plugin_registry SET enabled = 0, action_required = 1, granted_authority = ? WHERE id = ?')
    for (const row of rows) {
      try {
        if (row.source === 'bundled') updateBundled.run(JSON.stringify(authorityFromManifest(JSON.parse(row.manifest) as unknown)), row.id)
        else requireReview.run('{"version":1,"permissions":[],"networkOrigins":[],"environmentNames":[]}', row.id)
      } catch {
        requireReview.run('{"version":1,"permissions":[],"networkOrigins":[],"environmentNames":[]}', row.id)
      }
    }
  },
})
