CREATE TABLE `market_last_success` (
	`cache_key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`data_time` text NOT NULL,
	`fetched_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `market_cache_expiry_idx` ON `market_last_success` (`expires_at`);