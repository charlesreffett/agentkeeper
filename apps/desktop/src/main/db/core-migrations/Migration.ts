import type { Schema } from './Schema'

export interface Migration {
  readonly id: number
  readonly name: string
  readonly revision: number
  readonly checksumSource: string
  readonly transaction?: 'required' | 'manual'
  up(schema: Schema): void
}

export function defineMigration(migration: Migration): Migration {
  return migration
}

export interface MigrationResult {
  readonly applied: readonly number[]
}
