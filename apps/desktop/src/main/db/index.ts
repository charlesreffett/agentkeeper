import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import * as schema from './schema'
import { migrateJsonPlansToDb } from './migrate-plans'
import { coreMigrations } from './core-migrations/registry'
import { runCoreMigrations, type MigrationResult } from './core-migrations/runner'
import { SqliteSchema } from './core-migrations/Schema'
import { verifyCurrentSchema } from './core-migrations/verify'

export type AppDb = BetterSQLite3Database<typeof schema>

let _db: AppDb | null = null
let _sqlite: InstanceType<typeof Database> | null = null

function hasApplicationTables(sqlite: InstanceType<typeof Database>): boolean {
  return sqlite.prepare(`
    SELECT 1 FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT IN ('app_migrations', '__drizzle_migrations')
    LIMIT 1
  `).get() !== undefined
}

function migrationsPending(sqlite: InstanceType<typeof Database>): boolean {
  const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_migrations'").get()
  if (!exists) return true
  const row = sqlite.prepare('SELECT MAX(id) AS id FROM app_migrations').get() as { id: number | null }
  return (row.id ?? 0) < coreMigrations[coreMigrations.length - 1]!.id
}

async function backupBeforeMigration(sqlite: InstanceType<typeof Database>, userDataPath: string): Promise<void> {
  const backupDirectory = path.join(userDataPath, 'backups')
  fs.mkdirSync(backupDirectory, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  await sqlite.backup(path.join(backupDirectory, `agentkeeper-before-migration-${stamp}.db`))

  const backups = fs.readdirSync(backupDirectory)
    .filter((name) => name.startsWith('agentkeeper-before-migration-') && name.endsWith('.db'))
    .sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - 5))) {
    fs.unlinkSync(path.join(backupDirectory, old))
  }
}

export async function initDb(userDataPath: string, appVersion = 'development'): Promise<void> {
  const sqlite = new Database(path.join(userDataPath, 'agentkeeper.db'))
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')

    const hadApplicationTables = hasApplicationTables(sqlite)
    const hadCoreHistory = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_migrations'").get() !== undefined
    if (hadApplicationTables && (!hadCoreHistory || migrationsPending(sqlite))) {
      await backupBeforeMigration(sqlite, userDataPath)
    }

    // Pre-release builds used Drizzle's migration history. Adopt those
    // databases based on their actual schema rather than retaining the old
    // journal and SQL files solely for bookkeeping compatibility.
    if (hadApplicationTables && !hadCoreHistory) {
      try {
        verifyCurrentSchema(new SqliteSchema(sqlite))
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Existing database is incompatible with the current schema: ${detail}`)
      }
    }

    runCoreMigrations(sqlite, coreMigrations, appVersion)
    verifyCurrentSchema(new SqliteSchema(sqlite))
    _sqlite = sqlite
    _db = drizzle(sqlite, { schema })
    void migrateJsonPlansToDb(_db).catch((err) => {
      console.error('[db] JSON plans migration failed (non-fatal):', err)
    })
  } catch (error) {
    sqlite.close()
    throw error
  }
}

export function runMigrations(appVersion = 'development'): MigrationResult {
  if (!_sqlite) throw new Error('[db] not initialized')
  return runCoreMigrations(_sqlite, coreMigrations, appVersion)
}

export function getDb(): AppDb {
  if (!_db) throw new Error('[db] not initialized — call initDb first')
  return _db
}

export function getRawSqlite(): InstanceType<typeof Database> {
  if (!_sqlite) throw new Error('[db] not initialized — call initDb first')
  return _sqlite
}
