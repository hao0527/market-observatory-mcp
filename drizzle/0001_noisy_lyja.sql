CREATE TABLE `security_archive_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`lease_until` text NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `security_jobs_updated_idx` ON `security_archive_jobs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `security_archive_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `security_archive_tasks` (
	`job_id` text NOT NULL,
	`task_key` text NOT NULL,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`job_id`, `task_key`)
);
--> statement-breakpoint
CREATE TABLE `security_history_bars` (
	`symbol` text NOT NULL,
	`period` text NOT NULL,
	`adjust` text NOT NULL,
	`source` text NOT NULL,
	`timestamp` integer NOT NULL,
	`session_date` text NOT NULL,
	`payload` text NOT NULL,
	`fetched_at` text NOT NULL,
	`field_rank` integer NOT NULL,
	`fetch_id` text NOT NULL,
	PRIMARY KEY(`symbol`, `period`, `adjust`, `source`, `timestamp`)
);
--> statement-breakpoint
CREATE INDEX `security_bars_range_idx` ON `security_history_bars` (`symbol`,`period`,`adjust`,`source`,`session_date`);--> statement-breakpoint
CREATE TABLE `security_history_fetches` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`period` text NOT NULL,
	`adjust` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL,
	`security_name` text,
	`payload` text NOT NULL
);
