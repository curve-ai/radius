CREATE TABLE `project_roots` (
	`project_id` text NOT NULL,
	`client_instance_id` text NOT NULL,
	`root_path` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	PRIMARY KEY(`project_id`, `client_instance_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_roots_path_nonempty" CHECK(length(trim("project_roots"."root_path")) > 0),
	CONSTRAINT "project_roots_updated_after_created" CHECK("project_roots"."updated_at_ms" >= "project_roots"."created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_roots_client_path_uq` ON `project_roots` (`client_instance_id`,`root_path`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`origin_client_instance_id` text NOT NULL,
	`name` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`archived_at_ms` integer,
	`deleted_at_ms` integer,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "projects_name_nonempty" CHECK(length(trim("projects"."name")) > 0),
	CONSTRAINT "projects_revision_positive" CHECK("projects"."revision" > 0),
	CONSTRAINT "projects_updated_after_created" CHECK("projects"."updated_at_ms" >= "projects"."created_at_ms"),
	CONSTRAINT "projects_archived_after_created" CHECK("projects"."archived_at_ms" is null or "projects"."archived_at_ms" >= "projects"."created_at_ms"),
	CONSTRAINT "projects_deleted_after_created" CHECK("projects"."deleted_at_ms" is null or "projects"."deleted_at_ms" >= "projects"."created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `projects_updated_at_idx` ON `projects` (`updated_at_ms`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_local_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`origin_client_instance_id` text NOT NULL,
	`project_id` text,
	`project_revision` integer,
	`session_id` text,
	`session_revision` integer,
	`event_id` text,
	`kind` text NOT NULL,
	`payload_schema_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "local_changes_kind_valid" CHECK("__new_local_changes"."kind" in ('project.upsert', 'project.delete', 'session.upsert', 'session.event.append', 'session.delete')),
	CONSTRAINT "local_changes_target_matches_kind" CHECK((
        ("__new_local_changes"."kind" in ('project.upsert', 'project.delete') and "__new_local_changes"."project_id" is not null and "__new_local_changes"."project_revision" is not null and "__new_local_changes"."session_id" is null and "__new_local_changes"."session_revision" is null and "__new_local_changes"."event_id" is null)
        or
        ("__new_local_changes"."kind" in ('session.upsert', 'session.event.append', 'session.delete') and "__new_local_changes"."project_id" is null and "__new_local_changes"."project_revision" is null and "__new_local_changes"."session_id" is not null and "__new_local_changes"."session_revision" is not null)
      )),
	CONSTRAINT "local_changes_payload_schema_version_positive" CHECK("__new_local_changes"."payload_schema_version" > 0),
	CONSTRAINT "local_changes_hash_valid" CHECK(length("__new_local_changes"."payload_sha256") = 64 and "__new_local_changes"."payload_sha256" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
INSERT INTO `__new_local_changes`("id", "origin_client_instance_id", "project_id", "project_revision", "session_id", "session_revision", "event_id", "kind", "payload_schema_version", "payload_json", "payload_sha256", "created_at_ms") SELECT "id", "origin_client_instance_id", NULL, NULL, "session_id", "session_revision", "event_id", "kind", "payload_schema_version", "payload_json", "payload_sha256", "created_at_ms" FROM `local_changes`;--> statement-breakpoint
DROP TABLE `local_changes`;--> statement-breakpoint
ALTER TABLE `__new_local_changes` RENAME TO `local_changes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `local_changes_project_revision_uq` ON `local_changes` (`project_id`,`project_revision`) WHERE "local_changes"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `local_changes_session_revision_uq` ON `local_changes` (`session_id`,`session_revision`) WHERE "local_changes"."session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `local_changes_event_uq` ON `local_changes` (`event_id`) WHERE "local_changes"."event_id" is not null;--> statement-breakpoint
CREATE INDEX `local_changes_created_at_idx` ON `local_changes` (`created_at_ms`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `project_id` text REFERENCES projects(id) ON DELETE restrict;--> statement-breakpoint
CREATE INDEX `sessions_project_updated_at_idx` ON `sessions` (`project_id`,`updated_at_ms`);
