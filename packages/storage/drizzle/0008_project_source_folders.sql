PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_project_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`client_instance_id` text NOT NULL,
	`root_path` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_roots_path_nonempty" CHECK(length(trim("__new_project_roots"."root_path")) > 0),
	CONSTRAINT "project_roots_updated_after_created" CHECK("__new_project_roots"."updated_at_ms" >= "__new_project_roots"."created_at_ms")
);
--> statement-breakpoint
INSERT INTO `__new_project_roots`("id", "project_id", "client_instance_id", "root_path", "created_at_ms", "updated_at_ms") SELECT lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))), "project_id", "client_instance_id", "root_path", "created_at_ms", "updated_at_ms" FROM `project_roots`;--> statement-breakpoint
DROP TABLE `project_roots`;--> statement-breakpoint
ALTER TABLE `__new_project_roots` RENAME TO `project_roots`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `project_roots_project_client_idx` ON `project_roots` (`project_id`,`client_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_roots_client_path_uq` ON `project_roots` (`client_instance_id`,`root_path`);
