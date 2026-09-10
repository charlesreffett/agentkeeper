import { defineMigration } from './Migration'

const checksumSource = `
projects: replace the GitHub-specific repo slug with provider-neutral remote metadata
preserve existing GitHub slugs as an origin remote snapshot
`

export function legacyGithubRemote(repository: string) {
  return {
    name: 'origin',
    url: `https://github.com/${repository}`,
    provider: 'github',
    repository,
  }
}

export default defineMigration({
  id: 4,
  name: 'provider-neutral-project-remotes',
  revision: 1,
  checksumSource,
  up(schema) {
    schema.alterTable('projects', (table) => {
      table.text('remotes').notNull().default('[]')
    })

    const rows = schema.prepare('SELECT path, repo FROM projects WHERE repo IS NOT NULL').all() as Array<{ path: string; repo: string }>
    const update = schema.prepare('UPDATE projects SET remotes = ? WHERE path = ?')
    for (const row of rows) {
      update.run(JSON.stringify([legacyGithubRemote(row.repo)]), row.path)
    }

    schema.alterTable('projects', (table) => table.dropColumn('repo'))
  },
})
