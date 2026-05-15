-- Migration 0005: session-agent split
-- Separates agent-level data from sessions into a dedicated agents table.

-- ── A. DDL ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents (
  local_id              TEXT PRIMARY KEY,
  session_local_id      TEXT NOT NULL REFERENCES sessions(local_id) ON DELETE CASCADE,
  sdk_session_id        TEXT,
  role_id               TEXT,
  role_name             TEXT,
  role_instance_index   INTEGER,
  initial_prompt        TEXT NOT NULL DEFAULT '',
  is_entry_point        INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'idle',
  started_at            INTEGER NOT NULL,
  last_activity_at      INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE session_stats ADD COLUMN agent_local_id TEXT;
--> statement-breakpoint

-- ── B. Solo sessions (agency_instance_id IS NULL) ─────────────────────────────
-- One agents row per session; same UUID for both agent and session.

INSERT OR IGNORE INTO agents (
  local_id, session_local_id, sdk_session_id, role_id, role_name,
  role_instance_index, initial_prompt, is_entry_point, status,
  started_at, last_activity_at
)
SELECT
  local_id, local_id, sdk_session_id, role_id, role_name,
  role_instance_index, initial_prompt, 1, status,
  started_at, last_activity_at
FROM sessions
WHERE agency_instance_id IS NULL;
--> statement-breakpoint

-- ── C. Agency sessions ────────────────────────────────────────────────────────

-- C1a. Insert one sessions row per agency group using entry-point member metadata.
-- Entry point = earliest started member whose initialPrompt is NOT a placeholder.
INSERT OR IGNORE INTO sessions (
  local_id, project_path, worktree_path, branch, model, effort,
  permission_mode, initial_prompt, agency_name, agency_id, agency_scope,
  title, work_item_key, work_item_title, plan_state, status,
  started_at, last_activity_at
)
SELECT
  s.agency_instance_id,
  ep.project_path,
  ep.worktree_path,
  ep.branch,
  ep.model,
  ep.effort,
  ep.permission_mode,
  ep.initial_prompt,
  ep.agency_name,
  ep.agency_id,
  ep.agency_scope,
  ep.title,
  ep.work_item_key,
  ep.work_item_title,
  ep.plan_state,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM sessions m
      WHERE m.agency_instance_id = s.agency_instance_id
        AND (m.status = 'running' OR m.status = 'starting')
    ) THEN 'running'
    ELSE ep.status
  END,
  (SELECT MIN(started_at) FROM sessions WHERE agency_instance_id = s.agency_instance_id),
  (SELECT MAX(last_activity_at) FROM sessions WHERE agency_instance_id = s.agency_instance_id)
FROM sessions s
JOIN sessions ep ON ep.local_id = (
  SELECT local_id FROM sessions
  WHERE agency_instance_id = s.agency_instance_id
    AND initial_prompt NOT LIKE 'Agency "%'
    AND initial_prompt NOT LIKE '(awaiting peers)'
  ORDER BY started_at ASC
  LIMIT 1
)
WHERE s.agency_instance_id IS NOT NULL
GROUP BY s.agency_instance_id;
--> statement-breakpoint

-- C1b. Fallback: agency groups where ALL members have placeholder prompts.
INSERT OR IGNORE INTO sessions (
  local_id, project_path, worktree_path, branch, model, effort,
  permission_mode, initial_prompt, agency_name, agency_id, agency_scope,
  title, work_item_key, work_item_title, plan_state, status,
  started_at, last_activity_at
)
SELECT
  s.agency_instance_id,
  fallback.project_path,
  fallback.worktree_path,
  fallback.branch,
  fallback.model,
  fallback.effort,
  fallback.permission_mode,
  fallback.initial_prompt,
  fallback.agency_name,
  fallback.agency_id,
  fallback.agency_scope,
  fallback.title,
  fallback.work_item_key,
  fallback.work_item_title,
  fallback.plan_state,
  fallback.status,
  (SELECT MIN(started_at) FROM sessions WHERE agency_instance_id = s.agency_instance_id),
  (SELECT MAX(last_activity_at) FROM sessions WHERE agency_instance_id = s.agency_instance_id)
FROM sessions s
JOIN sessions fallback ON fallback.local_id = (
  SELECT local_id FROM sessions
  WHERE agency_instance_id = s.agency_instance_id
  ORDER BY started_at ASC
  LIMIT 1
)
WHERE s.agency_instance_id IS NOT NULL
GROUP BY s.agency_instance_id;
--> statement-breakpoint

-- C2. Insert agents rows for all agency member sessions.
-- Entry point = member whose prompt is NOT a placeholder (earliest started).
INSERT OR IGNORE INTO agents (
  local_id, session_local_id, sdk_session_id, role_id, role_name,
  role_instance_index, initial_prompt, is_entry_point, status,
  started_at, last_activity_at
)
SELECT
  m.local_id,
  m.agency_instance_id,
  m.sdk_session_id,
  m.role_id,
  m.role_name,
  m.role_instance_index,
  m.initial_prompt,
  CASE WHEN m.initial_prompt NOT LIKE 'Agency "%'
            AND m.initial_prompt NOT LIKE '(awaiting peers)'
            AND m.started_at = (
              SELECT MIN(started_at) FROM sessions
              WHERE agency_instance_id = m.agency_instance_id
                AND initial_prompt NOT LIKE 'Agency "%'
                AND initial_prompt NOT LIKE '(awaiting peers)'
            )
       THEN 1 ELSE 0 END,
  m.status,
  m.started_at,
  m.last_activity_at
FROM sessions m
WHERE m.agency_instance_id IS NOT NULL;
--> statement-breakpoint

-- C3. Consolidate session_stats: one aggregate row per agency group.
INSERT OR REPLACE INTO session_stats (session_local_id, total_tokens, total_cost_usd, turn_count, in_progress_tokens, updated_at)
SELECT
  s.agency_instance_id,
  COALESCE(SUM(st.total_tokens), 0),
  COALESCE(SUM(st.total_cost_usd), 0.0),
  COALESCE(SUM(st.turn_count), 0),
  0,
  COALESCE(MAX(st.updated_at), strftime('%s','now') * 1000)
FROM sessions s
LEFT JOIN session_stats st ON st.session_local_id = s.local_id
WHERE s.agency_instance_id IS NOT NULL
GROUP BY s.agency_instance_id;
--> statement-breakpoint

-- Delete old per-member stat rows.
DELETE FROM session_stats
WHERE session_local_id IN (
  SELECT local_id FROM sessions WHERE agency_instance_id IS NOT NULL
);
--> statement-breakpoint

-- C4. Re-key drafts: update draft session_local_id from member localId → agencyInstanceId.
UPDATE drafts SET session_local_id = (
  SELECT agency_instance_id FROM sessions WHERE local_id = drafts.session_local_id
)
WHERE session_local_id IN (
  SELECT local_id FROM sessions WHERE agency_instance_id IS NOT NULL
);
--> statement-breakpoint

-- C5. Delete all agency member sessions rows (agents rows remain via the new agents table).
DELETE FROM sessions WHERE agency_instance_id IS NOT NULL;
--> statement-breakpoint

-- ── D. Drop removed columns from sessions ─────────────────────────────────────

ALTER TABLE sessions DROP COLUMN sdk_session_id;
--> statement-breakpoint
ALTER TABLE sessions DROP COLUMN role_id;
--> statement-breakpoint
ALTER TABLE sessions DROP COLUMN role_name;
--> statement-breakpoint
ALTER TABLE sessions DROP COLUMN role_instance_index;
--> statement-breakpoint
ALTER TABLE sessions DROP COLUMN agency_instance_id;
