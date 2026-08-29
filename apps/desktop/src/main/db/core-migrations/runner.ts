import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import { SqliteSchema } from './Schema'
import type { Migration, MigrationResult } from './Migration'

export type { MigrationResult } from './Migration'

interface AppliedMigration {
  id: number
  name: string
  checksum: string
}

function checksum(migration: Migration): string {
  return crypto.createHash('sha256')
    .update(`${migration.id}\n${migration.name}\n${migration.revision}\n${migration.checksumSource}`)
    .digest('hex')
}

export function validateMigrations(migrations: readonly Migration[]): void {
  let previous = 0
  const names = new Set<string>()
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.id) || migration.id <= 0) {
      throw new Error(`Migration ID must be a positive integer: ${migration.id}`)
    }
    if (migration.id <= previous) throw new Error(`Migration IDs are not strictly increasing at ${migration.id}`)
    if (names.has(migration.name)) throw new Error(`Duplicate migration name: ${migration.name}`)
    previous = migration.id
    names.add(migration.name)
  }
}

export function runCoreMigrations(
  db: Database.Database,
  migrations: readonly Migration[],
  appVersion: string,
): MigrationResult {
  validateMigrations(migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      app_version TEXT
    );
  `)

  const appliedRows = db.prepare(
    'SELECT id, name, checksum FROM app_migrations ORDER BY id',
  ).all() as AppliedMigration[]
  const applied = new Map(appliedRows.map((row) => [row.id, row]))
  const known = new Map(migrations.map((migration) => [migration.id, migration]))

  for (const row of appliedRows) {
    const migration = known.get(row.id)
    if (!migration) throw new Error(`Database contains unknown migration ${row.id} (${row.name}); this app may be older than the database`)
    const expected = checksum(migration)
    if (row.name !== migration.name || row.checksum !== expected) {
      throw new Error(`Applied migration ${row.id} no longer matches ${migration.name}; released migrations are immutable`)
    }
  }

  const schema = new SqliteSchema(db)
  const newlyApplied: number[] = []
  for (const migration of migrations) {
    if (applied.has(migration.id)) continue
    const started = Date.now()
    const execute = () => {
      migration.up(schema)
      const migrationViolations = db.pragma('foreign_key_check') as unknown[]
      if (migrationViolations.length > 0) {
        throw new Error(`Migration ${migration.id} caused ${migrationViolations.length} foreign-key violation(s)`)
      }
      db.prepare(`
        INSERT INTO app_migrations (id, name, checksum, applied_at, duration_ms, app_version)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(migration.id, migration.name, checksum(migration), Date.now(), Date.now() - started, appVersion)
    }
    if (migration.transaction === 'manual') execute()
    else db.transaction(execute)()
    newlyApplied.push(migration.id)
  }

  const violations = db.pragma('foreign_key_check') as unknown[]
  if (violations.length > 0) throw new Error(`Foreign-key check failed after migrations (${violations.length} violation(s))`)
  return { applied: newlyApplied }
}
