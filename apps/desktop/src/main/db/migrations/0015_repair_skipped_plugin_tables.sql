-- 0009 was originally journaled with a seconds-based timestamp while the
-- surrounding migrations use milliseconds. Existing databases can therefore
-- have later migrations recorded as applied without ever creating these
-- tables. Keep this repair idempotent for both affected and fresh databases.
CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  manifest TEXT NOT NULL,
  source TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  dev_path TEXT
);
