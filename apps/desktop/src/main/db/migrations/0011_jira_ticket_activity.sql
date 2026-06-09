CREATE TABLE IF NOT EXISTS jira_ticket_activity (
  id TEXT PRIMARY KEY,
  ticket_ref TEXT NOT NULL,
  actor TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jira_ticket_activity_ticket_ref ON jira_ticket_activity(ticket_ref);
