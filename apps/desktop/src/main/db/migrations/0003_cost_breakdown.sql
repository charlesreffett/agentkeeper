ALTER TABLE `cost_entries` ADD `input_cost_usd` real NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `output_cost_usd` real NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `cache_read_cost_usd` real NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `cost_entries` ADD `cache_creation_cost_usd` real NOT NULL DEFAULT 0;
