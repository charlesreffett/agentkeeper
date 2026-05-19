-- Migration 0007: plans and plan_steps tables

CREATE TABLE IF NOT EXISTS `plans` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL REFERENCES `projects`(`path`) ON DELETE CASCADE,
  `session_id` text REFERENCES `sessions`(`local_id`) ON DELETE SET NULL,
  `work_item_id` text,
  `plan_ref` text,
  `title` text NOT NULL,
  `prompt` text,
  `status` text NOT NULL DEFAULT 'planned',
  `planning_model` text,
  `estimated_minutes` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `started_at` integer,
  `updated_at` integer NOT NULL,
  `completed_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `plan_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL REFERENCES `plans`(`id`) ON DELETE CASCADE,
  `position` integer NOT NULL,
  `title` text NOT NULL,
  `summary` text,
  `instructions` text,
  `files_in_scope` text NOT NULL DEFAULT '[]',
  `model` text NOT NULL,
  `agent` text NOT NULL,
  `estimated_minutes` integer NOT NULL DEFAULT 0,
  `actual_minutes` integer,
  `status` text NOT NULL DEFAULT 'pending',
  `parallel` integer NOT NULL DEFAULT 0,
  `requires_approval` integer NOT NULL DEFAULT 0,
  `context` text,
  `started_at` integer,
  `completed_at` integer,
  `failed_at` integer
);
