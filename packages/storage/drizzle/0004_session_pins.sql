CREATE TABLE `session_pins` (
	`client_instance_id` text NOT NULL,
	`session_id` text NOT NULL,
	`pinned_at_ms` integer NOT NULL,
	PRIMARY KEY(`client_instance_id`, `session_id`),
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "session_pins_pinned_at_positive" CHECK("session_pins"."pinned_at_ms" > 0)
);
--> statement-breakpoint
CREATE INDEX `session_pins_client_pinned_at_idx` ON `session_pins` (`client_instance_id`,`pinned_at_ms`);