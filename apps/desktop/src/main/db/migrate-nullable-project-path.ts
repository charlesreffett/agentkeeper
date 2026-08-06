import type { AppDb } from './index'
import { appState } from './schema'

/**
 * SQLite cannot drop a NOT NULL constraint via ALTER TABLE, so this drops and
 * recreates the sessions table with a nullable project_path. Runs outside
 * drizzle's migrator (which wraps everything in a single transaction where
 * PRAGMA foreign_keys is a no-op). Uses the documented rebuild procedure:
 * create new → copy → drop old → rename new back to the old name, with
 * foreign_keys toggled off around it so the DROP of a referenced table is legal.
 * Also backfills the legacy '__general__' sentinel to NULL.
 */
export function migrateNullableProjectPath(db: AppDb, sqlite: import('better-sqlite3').Database): void {
  const marker = sqlite
    .prepare('SELECT value FROM app_state WHERE key = ?')
    .get('project_path_nullable_v1') as { value: string } | undefined
  if (marker) return

  sqlite.pragma('foreign_keys = OFF')
  sqlite.transaction(() => {
    sqlite.exec(`
CREATE TABLE "new_sessions" (
  "local_id" text PRIMARY KEY NOT NULL,
  "project_path" text,
  "worktree_path" text,
  "branch" text,
  "model" text,
  "effort" text,
  "permission_mode" text,
  "harness_id" text NOT NULL DEFAULT 'claude-code',
  "initial_prompt" text NOT NULL DEFAULT '',
  "agency_name" text,
  "agency_id" text,
  "agency_scope" text,
  "title" text,
  "work_item_key" text,
  "work_item_title" text,
  "plan_state" text,
  "status" text NOT NULL DEFAULT 'idle',
  "started_at" integer NOT NULL,
  "last_activity_at" integer NOT NULL,
  "last_user_message_at" integer
);
INSERT INTO "new_sessions" (
  "local_id", "project_path", "worktree_path", "branch", "model", "effort",
  "permission_mode", "harness_id", "initial_prompt", "agency_name", "agency_id",
  "agency_scope", "title", "work_item_key", "work_item_title", "plan_state",
  "status", "started_at", "last_activity_at", "last_user_message_at"
)
SELECT
  "local_id", "project_path", "worktree_path", "branch", "model", "effort",
  "permission_mode", "harness_id", "initial_prompt", "agency_name", "agency_id",
  "agency_scope", "title", "work_item_key", "work_item_title", "plan_state",
  "status", "started_at", "last_activity_at", "last_user_message_at"
FROM "sessions";
UPDATE "new_sessions" SET "project_path" = NULL WHERE "project_path" = '__general__';
DROP TABLE "sessions";
ALTER TABLE "new_sessions" RENAME TO "sessions";
`)
  })()
  sqlite.pragma('foreign_keys = ON')

  db.insert(appState).values({ key: 'project_path_nullable_v1', value: '1' }).run()
  console.log('[db] sessions.project_path made nullable; legacy general sessions backfilled to NULL')
}
