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
	CONSTRAINT "composer_drafts_content_length_valid" CHECK(length("composer_drafts"."content") between 1 and 100000),
	CONSTRAINT "composer_drafts_updated_after_created" CHECK("composer_drafts"."updated_at_ms" >= "composer_drafts"."created_at_ms")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `composer_drafts_session_uq` ON `composer_drafts` (`client_instance_id`,`session_id`) WHERE "composer_drafts"."kind" = 'session';--> statement-breakpoint
CREATE UNIQUE INDEX `composer_drafts_project_new_chat_uq` ON `composer_drafts` (`client_instance_id`,`project_id`) WHERE "composer_drafts"."kind" = 'new_chat' and "composer_drafts"."project_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `composer_drafts_standalone_new_chat_uq` ON `composer_drafts` (`client_instance_id`,`kind`) WHERE "composer_drafts"."kind" = 'new_chat' and "composer_drafts"."project_id" is null;--> statement-breakpoint
CREATE INDEX `composer_drafts_updated_at_idx` ON `composer_drafts` (`updated_at_ms`);