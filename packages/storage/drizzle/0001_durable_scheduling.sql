CREATE TABLE `scheduled_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`schedule_revision` integer NOT NULL,
	`scheduled_for_ms` integer NOT NULL,
	`coalesced_through_ms` integer NOT NULL,
	`coalesced_occurrence_count` integer DEFAULT 1 NOT NULL,
	`request_schema_id` text NOT NULL,
	`request_schema_version` integer NOT NULL,
	`request_json` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at_ms` integer,
	`lease_token` text,
	`lease_expires_at_ms` integer,
	`session_id` text,
	`created_at_ms` integer NOT NULL,
	`started_at_ms` integer,
	`finished_at_ms` integer,
	`last_error_code` text,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "scheduled_runs_schedule_revision_positive" CHECK("scheduled_runs"."schedule_revision" > 0),
	CONSTRAINT "scheduled_runs_coalesced_range_valid" CHECK("scheduled_runs"."coalesced_through_ms" >= "scheduled_runs"."scheduled_for_ms"),
	CONSTRAINT "scheduled_runs_coalesced_count_positive" CHECK("scheduled_runs"."coalesced_occurrence_count" > 0),
	CONSTRAINT "scheduled_runs_request_schema_id_nonempty" CHECK(length(trim("scheduled_runs"."request_schema_id")) > 0),
	CONSTRAINT "scheduled_runs_request_schema_version_positive" CHECK("scheduled_runs"."request_schema_version" > 0),
	CONSTRAINT "scheduled_runs_request_json_valid" CHECK(json_valid("scheduled_runs"."request_json")),
	CONSTRAINT "scheduled_runs_state_valid" CHECK("scheduled_runs"."state" in ('pending', 'leased', 'dispatched', 'completed', 'failed', 'cancelled', 'skipped')),
	CONSTRAINT "scheduled_runs_attempt_count_valid" CHECK("scheduled_runs"."attempt_count" >= 0),
	CONSTRAINT "scheduled_runs_lease_matches_state" CHECK((
        ("scheduled_runs"."state" = 'leased' and "scheduled_runs"."lease_token" is not null and "scheduled_runs"."lease_expires_at_ms" is not null)
        or
        ("scheduled_runs"."state" != 'leased' and "scheduled_runs"."lease_token" is null and "scheduled_runs"."lease_expires_at_ms" is null)
      )),
	CONSTRAINT "scheduled_runs_finished_matches_state" CHECK((
        ("scheduled_runs"."state" in ('completed', 'failed', 'cancelled', 'skipped') and "scheduled_runs"."finished_at_ms" is not null)
        or
        ("scheduled_runs"."state" not in ('completed', 'failed', 'cancelled', 'skipped') and "scheduled_runs"."finished_at_ms" is null)
      )),
	CONSTRAINT "scheduled_runs_session_matches_state" CHECK("scheduled_runs"."session_id" is null or "scheduled_runs"."state" in ('dispatched', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_runs_occurrence_uq` ON `scheduled_runs` (`schedule_id`,`scheduled_for_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_runs_session_uq` ON `scheduled_runs` (`session_id`) WHERE "scheduled_runs"."session_id" is not null;--> statement-breakpoint
CREATE INDEX `scheduled_runs_claim_idx` ON `scheduled_runs` (`state`,`available_at_ms`,`lease_expires_at_ms`);--> statement-breakpoint
CREATE INDEX `scheduled_runs_schedule_revision_idx` ON `scheduled_runs` (`schedule_id`,`schedule_revision`,`coalesced_through_ms`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`origin_client_instance_id` text NOT NULL,
	`title` text NOT NULL,
	`cron_expression` text NOT NULL,
	`timezone` text NOT NULL,
	`missed_run_policy` text DEFAULT 'catch_up_once' NOT NULL,
	`max_catch_up_age_ms` integer DEFAULT 86400000 NOT NULL,
	`replay_limit` integer DEFAULT 20 NOT NULL,
	`request_schema_id` text NOT NULL,
	`request_schema_version` integer NOT NULL,
	`request_json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "schedules_title_nonempty" CHECK(length(trim("schedules"."title")) > 0),
	CONSTRAINT "schedules_cron_expression_nonempty" CHECK(length(trim("schedules"."cron_expression")) > 0),
	CONSTRAINT "schedules_timezone_nonempty" CHECK(length(trim("schedules"."timezone")) > 0),
	CONSTRAINT "schedules_missed_run_policy_valid" CHECK("schedules"."missed_run_policy" in ('catch_up_once', 'skip', 'ask', 'replay_all')),
	CONSTRAINT "schedules_max_catch_up_age_valid" CHECK("schedules"."max_catch_up_age_ms" >= 0),
	CONSTRAINT "schedules_replay_limit_valid" CHECK("schedules"."replay_limit" > 0),
	CONSTRAINT "schedules_request_schema_id_nonempty" CHECK(length(trim("schedules"."request_schema_id")) > 0),
	CONSTRAINT "schedules_request_schema_version_positive" CHECK("schedules"."request_schema_version" > 0),
	CONSTRAINT "schedules_request_json_valid" CHECK(json_valid("schedules"."request_json")),
	CONSTRAINT "schedules_revision_positive" CHECK("schedules"."revision" > 0),
	CONSTRAINT "schedules_timestamps_ordered" CHECK("schedules"."updated_at_ms" >= "schedules"."created_at_ms")
);
--> statement-breakpoint
CREATE INDEX `schedules_active_idx` ON `schedules` (`enabled`,`deleted_at_ms`);