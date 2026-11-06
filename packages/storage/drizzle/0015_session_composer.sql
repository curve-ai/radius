ALTER TABLE `sessions` ADD `access_mode` text NOT NULL DEFAULT 'project' CHECK (`access_mode` IN ('ask', 'project', 'full'));
--> statement-breakpoint
ALTER TABLE `composer_drafts` RENAME TO `composer_drafts_before_attachments`;
--> statement-breakpoint
CREATE TABLE `composer_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`session_id` text,
	`content` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "composer_drafts_context_valid" CHECK(("composer_drafts"."kind" = 'new_chat' and "composer_drafts"."session_id" is null) or ("composer_drafts"."kind" = 'session' and "composer_drafts"."project_id" is null and "composer_drafts"."session_id" is not null)),
	CONSTRAINT "composer_drafts_content_length_valid" CHECK(length("composer_drafts"."content") between 0 and 100000),
	CONSTRAINT "composer_drafts_updated_after_created" CHECK("composer_drafts"."updated_at_ms" >= "composer_drafts"."created_at_ms")
);

--> statement-breakpoint
INSERT INTO `composer_drafts` SELECT * FROM `composer_drafts_before_attachments`;
--> statement-breakpoint
DROP TABLE `composer_drafts_before_attachments`;
--> statement-breakpoint

CREATE UNIQUE INDEX `composer_drafts_session_uq` ON `composer_drafts` (`client_instance_id`,`session_id`) WHERE "composer_drafts"."kind" = 'session';--> statement-breakpoint

CREATE UNIQUE INDEX `composer_drafts_project_new_chat_uq` ON `composer_drafts` (`client_instance_id`,`project_id`) WHERE "composer_drafts"."kind" = 'new_chat' and "composer_drafts"."project_id" is not null;--> statement-breakpoint

CREATE UNIQUE INDEX `composer_drafts_standalone_new_chat_uq` ON `composer_drafts` (`client_instance_id`,`kind`) WHERE "composer_drafts"."kind" = 'new_chat' and "composer_drafts"."project_id" is null;--> statement-breakpoint

CREATE INDEX `composer_drafts_updated_at_idx` ON `composer_drafts` (`updated_at_ms`);
--> statement-breakpoint
CREATE TABLE `desktop_preferences` (
  `client_instance_id` text PRIMARY KEY NOT NULL REFERENCES `client_instances`(`id`) ON DELETE CASCADE,
  `default_access_mode` text NOT NULL DEFAULT 'project' CHECK (`default_access_mode` IN ('ask','project','full')),
  `updated_at_ms` integer NOT NULL CHECK (`updated_at_ms` > 0)
);
--> statement-breakpoint
CREATE TABLE `composer_draft_attachments` (
  `id` text PRIMARY KEY NOT NULL,
  `draft_id` text NOT NULL REFERENCES `composer_drafts`(`id`) ON DELETE CASCADE,
  `position` integer NOT NULL CHECK (`position` >= 0),
  `name` text NOT NULL CHECK (length(trim(`name`)) BETWEEN 1 AND 255),
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL CHECK (`byte_size` > 0),
  `content_sha256` text NOT NULL CHECK (length(`content_sha256`) = 64 AND `content_sha256` NOT GLOB '*[^0-9a-f]*'),
  `local_relative_path` text NOT NULL CHECK (length(`local_relative_path`) > 0),
  `last_modified` integer NOT NULL CHECK (`last_modified` >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `composer_draft_attachments_position_uq` ON `composer_draft_attachments` (`draft_id`,`position`);
