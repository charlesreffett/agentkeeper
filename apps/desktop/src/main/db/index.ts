import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import * as schema from './schema'
import { migrateJsonPlansToDb } from './migrate-plans'

export type AppDb = BetterSQLite3Database<typeof schema>

let _db: AppDb | null = null
const migrationsFolder = path.join(__dirname, 'migrations')

export function initDb(userDataPath: string): void {
  const sqlite = new Database(path.join(userDataPath, 'agentkeeper.db'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  _db = drizzle(sqlite, { schema })
  migrate(_db, { migrationsFolder })
  void migrateJsonPlansToDb(_db).catch((err) => {
    console.error('[db] JSON plans migration failed (non-fatal):', err)
  })
}

export function runMigrations(): void {
  if (!_db) throw new Error('[db] not initialized')
  migrate(_db, { migrationsFolder })
}

export function getDb(): AppDb {
  if (!_db) throw new Error('[db] not initialized — call initDb first')
  return _db
}
