import { defineMigration } from './Migration'

export const currentSchemaSql = `
CREATE TABLE IF NOT EXISTS projects (
  path TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  repo TEXT,
  last_opened_at INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  local_id TEXT PRIMARY KEY NOT NULL,
  project_path TEXT,
  worktree_path TEXT,
  branch TEXT,
  model TEXT,
  effort TEXT,
  permission_mode TEXT,
  harness_id TEXT NOT NULL DEFAULT 'claude-code',
  initial_prompt TEXT NOT NULL DEFAULT '',
  agency_name TEXT,
  agency_id TEXT,
  agency_scope TEXT,
  title TEXT,
  work_item_key TEXT,
  work_item_title TEXT,
  plan_state TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  last_user_message_at INTEGER
);

CREATE TABLE IF NOT EXISTS agents (
  local_id TEXT PRIMARY KEY NOT NULL,
  session_local_id TEXT NOT NULL REFERENCES sessions(local_id) ON DELETE CASCADE,
  sdk_session_id TEXT,
  role_id TEXT,
  role_name TEXT,
  role_instance_index INTEGER,
  initial_prompt TEXT NOT NULL DEFAULT '',
  is_entry_point INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'idle',
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agency_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  agency_instance_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  instance_index INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS cost_entries (
  key TEXT PRIMARY KEY NOT NULL,
  date TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  input_cost_usd REAL NOT NULL DEFAULT 0,
  output_cost_usd REAL NOT NULL DEFAULT 0,
  cache_read_cost_usd REAL NOT NULL DEFAULT 0,
  cache_creation_cost_usd REAL NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  session_local_id TEXT PRIMARY KEY NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_stats (
  session_local_id TEXT PRIMARY KEY NOT NULL,
  agent_local_id TEXT,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL DEFAULT 0,
  in_progress_tokens INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_pricing (
  model_id TEXT PRIMARY KEY NOT NULL,
  input_per_m REAL NOT NULL,
  output_per_m REAL NOT NULL,
  cache_write_5m_per_m REAL NOT NULL,
  cache_write_1h_per_m REAL NOT NULL,
  cache_read_per_m REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'bundled',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(path) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(local_id) ON DELETE SET NULL,
  work_item_id TEXT,
  plan_ref TEXT,
  title TEXT NOT NULL,
  prompt TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  planning_model TEXT,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  agency_id TEXT,
  agency_scope TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS plan_steps (
  id TEXT PRIMARY KEY NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  instructions TEXT,
  files_in_scope TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL,
  agent TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL DEFAULT 0,
  actual_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  parallel INTEGER NOT NULL DEFAULT 0,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  context TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  failed_at INTEGER
);

CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

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

CREATE TABLE IF NOT EXISTS jira_ticket_activity (
  id TEXT PRIMARY KEY,
  ticket_ref TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS jira_ticket_activity_ticket_ref
  ON jira_ticket_activity(ticket_ref);
`

export default defineMigration({
  id: 1,
  name: 'current-schema-baseline',
  revision: 1,
  checksumSource: currentSchemaSql,
  up(schema) {
    schema.exec(currentSchemaSql)
  },
})
