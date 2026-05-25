CREATE TABLE plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);
--> statement-breakpoint
CREATE TABLE plugin_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  manifest TEXT NOT NULL,
  source TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  dev_path TEXT
);
