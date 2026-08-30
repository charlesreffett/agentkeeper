import { describe, expect, it } from 'vitest'
import { coreMigrations } from './core-migrations/registry'
import { validateMigrations } from './core-migrations/runner'

describe('database migrations', () => {
  it('has a valid application-owned migration registry', () => {
    expect(() => validateMigrations(coreMigrations)).not.toThrow()
    expect(coreMigrations.map(({ id }) => id)).toEqual([1, 2])
  })
})
