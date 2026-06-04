-- Rename 'terminated' status to 'inactive' for agents and sessions.
-- Sessions can always be continued regardless of how they previously stopped.

UPDATE agents
   SET status = 'inactive'
 WHERE status = 'terminated';
--> statement-breakpoint

UPDATE sessions
   SET status = 'inactive'
 WHERE status = 'terminated';
