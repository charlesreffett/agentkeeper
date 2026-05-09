CREATE TABLE `agencies` (
	`instance_id` text PRIMARY KEY NOT NULL,
	`agency_id` text NOT NULL,
	`agency_scope` text NOT NULL,
	`agency_name` text NOT NULL,
	`work_item_title` text,
	`initial_prompt` text DEFAULT '' NOT NULL,
	`title` text,
	`project_path` text NOT NULL,
	`worktree_path` text,
	`branch` text,
	`started_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`role_session_map` text DEFAULT '{}' NOT NULL,
	`handoffs` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cost_entries` (
	`key` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_creation_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`recorded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`session_local_id` text PRIMARY KEY NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`path` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo` text,
	`last_opened_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_stats` (
	`session_local_id` text PRIMARY KEY NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`total_cost_usd` real DEFAULT 0 NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`in_progress_tokens` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`local_id` text PRIMARY KEY NOT NULL,
	`sdk_session_id` text,
	`project_path` text NOT NULL,
	`worktree_path` text,
	`branch` text,
	`model` text,
	`effort` text,
	`permission_mode` text,
	`initial_prompt` text DEFAULT '' NOT NULL,
	`role_name` text,
	`role_id` text,
	`agency_instance_id` text,
	`agency_name` text,
	`title` text,
	`work_item_key` text,
	`work_item_title` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`started_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL
);
