ALTER TABLE `sessions` ADD `agency_id` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `agency_scope` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `role_instance_index` integer;--> statement-breakpoint
CREATE TABLE `agency_handoffs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agency_instance_id` text NOT NULL,
	`role_id` text NOT NULL,
	`instance_index` integer NOT NULL,
	`summary` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
UPDATE sessions
SET agency_id = (SELECT agency_id FROM agencies WHERE instance_id = sessions.agency_instance_id),
    agency_scope = (SELECT agency_scope FROM agencies WHERE instance_id = sessions.agency_instance_id)
WHERE agency_instance_id IS NOT NULL;
--> statement-breakpoint
UPDATE sessions
SET role_instance_index = (
  SELECT COUNT(*)
  FROM sessions s2
  WHERE s2.agency_instance_id = sessions.agency_instance_id
    AND s2.role_id = sessions.role_id
    AND s2.started_at <= sessions.started_at
)
WHERE agency_instance_id IS NOT NULL AND role_id IS NOT NULL;
--> statement-breakpoint
DROP TABLE `agencies`;
