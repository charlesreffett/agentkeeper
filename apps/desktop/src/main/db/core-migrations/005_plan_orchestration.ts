import { defineMigration } from './Migration'

const checksumSource = `
plans: add a markdown brief every linked job reads
plan_sessions: link many sessions to one plan, backfilled from plans.session_id
progress_reports: append-only agent progress log
push_reviews: pre-push review receipts keyed by reviewed HEAD
`

export default defineMigration({
  id: 5,
  name: 'plan-orchestration',
  revision: 1,
  checksumSource,
  up(schema) {
    schema.alterTable('plans', (table) => {
      table.text('brief')
    })

    schema.exec(`
CREATE TABLE IF NOT EXISTS plan_sessions (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  session_local_id TEXT NOT NULL REFERENCES sessions(local_id) ON DELETE CASCADE,
  step_id TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (plan_id, session_local_id)
);
CREATE INDEX IF NOT EXISTS plan_sessions_session_idx ON plan_sessions(session_local_id);

CREATE TABLE IF NOT EXISTS progress_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  session_local_id TEXT NOT NULL REFERENCES sessions(local_id) ON DELETE CASCADE,
  agent_local_id TEXT NOT NULL,
  step_id TEXT,
  state TEXT NOT NULL,
  note TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS progress_reports_session_idx ON progress_reports(session_local_id, created_at);
CREATE INDEX IF NOT EXISTS progress_reports_plan_idx ON progress_reports(plan_id, created_at);

CREATE TABLE IF NOT EXISTS push_reviews (
  id TEXT PRIMARY KEY,
  session_local_id TEXT NOT NULL REFERENCES sessions(local_id) ON DELETE CASCADE,
  agent_local_id TEXT NOT NULL,
  plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL,
  branch TEXT,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  verdict TEXT NOT NULL,
  summary TEXT NOT NULL,
  findings TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_reviews_session_idx ON push_reviews(session_local_id, created_at);
`)

    schema.exec(`
INSERT OR IGNORE INTO plan_sessions (plan_id, session_local_id, step_id, added_at)
SELECT p.id, p.session_id, NULL, p.updated_at
FROM plans p
JOIN sessions s ON s.local_id = p.session_id
WHERE p.session_id IS NOT NULL;
UPDATE plans SET session_id = NULL WHERE session_id IS NOT NULL;
`)
  },
})
