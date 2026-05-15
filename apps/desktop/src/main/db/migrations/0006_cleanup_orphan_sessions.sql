-- Migration 0006: remove orphaned per-agent session rows left by 0005.
-- These were agency member sessions that should have been deleted in 0005.
-- Orphaned = agency_name set, but local_id is not the shared session UUID
-- (root sessions ARE referenced as session_local_id in agents; member sessions are not).
DELETE FROM sessions
WHERE agency_name IS NOT NULL
AND local_id NOT IN (SELECT DISTINCT session_local_id FROM agents);
