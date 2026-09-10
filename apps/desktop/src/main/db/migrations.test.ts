import { describe, expect, it } from 'vitest'
import { legacyGithubRemote } from './core-migrations/004_provider_neutral_project_remotes'
import { coreMigrations } from './core-migrations/registry'
import { validateMigrations } from './core-migrations/runner'

describe('database migrations', () => {
  it('has a valid application-owned migration registry', () => {
    expect(() => validateMigrations(coreMigrations)).not.toThrow()
    expect(coreMigrations.map(({ id }) => id)).toEqual([1, 2, 3, 4])
  })

  it('converts legacy GitHub repo slugs to provider-neutral remote metadata', () => {
    expect(legacyGithubRemote('owner/repo')).toEqual({
      name: 'origin',
      url: 'https://github.com/owner/repo',
      provider: 'github',
      repository: 'owner/repo',
    })
  })
})
