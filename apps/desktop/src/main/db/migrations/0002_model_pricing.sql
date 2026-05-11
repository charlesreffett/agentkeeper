CREATE TABLE `model_pricing` (
	`model_id` text PRIMARY KEY NOT NULL,
	`input_per_m` real NOT NULL,
	`output_per_m` real NOT NULL,
	`cache_write_5m_per_m` real NOT NULL,
	`cache_write_1h_per_m` real NOT NULL,
	`cache_read_per_m` real NOT NULL,
	`source` text NOT NULL DEFAULT 'bundled',
	`updated_at` integer NOT NULL
);
