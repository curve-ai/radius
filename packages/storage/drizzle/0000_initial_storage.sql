CREATE TABLE `approval_decisions` (
	`event_id` text PRIMARY KEY NOT NULL,
	`approval_request_event_id` text NOT NULL,
	`decision` text NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`note` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`approval_request_event_id`) REFERENCES `approval_requests`(`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "approval_decisions_decision_valid" CHECK("approval_decisions"."decision" in ('approved', 'denied', 'cancelled', 'expired')),
	CONSTRAINT "approval_decisions_actor_type_valid" CHECK("approval_decisions"."actor_type" in ('user', 'organization_policy', 'system'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_decisions_request_uq` ON `approval_decisions` (`approval_request_event_id`);--> statement-breakpoint
CREATE TABLE `approval_requests` (
	`event_id` text PRIMARY KEY NOT NULL,
	`tool_call_event_id` text NOT NULL,
	`reason` text NOT NULL,
	`expires_at_ms` integer,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_event_id`) REFERENCES `tool_calls`(`event_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_requests_tool_call_uq` ON `approval_requests` (`tool_call_event_id`);--> statement-breakpoint
CREATE TABLE `artifact_transfers` (
	`connection_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`remote_locator` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at_ms` integer,
	`completed_at_ms` integer,
	`last_error_code` text,
	PRIMARY KEY(`connection_id`, `artifact_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `sync_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `file_artifacts`(`artifact_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "artifact_transfers_state_valid" CHECK("artifact_transfers"."state" in ('pending', 'uploading', 'available', 'rejected')),
	CONSTRAINT "artifact_transfers_attempts_valid" CHECK("artifact_transfers"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`artifact_type` text NOT NULL,
	`created_by_event_id` text NOT NULL,
	`supersedes_artifact_id` text,
	`created_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`supersedes_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "artifacts_name_nonempty" CHECK(length(trim("artifacts"."name")) > 0),
	CONSTRAINT "artifacts_type_valid" CHECK("artifacts"."artifact_type" in ('document', 'presentation', 'image', 'dataset', 'archive', 'other'))
);
--> statement-breakpoint
CREATE TABLE `client_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`platform` text NOT NULL,
	`public_key_jwk` text NOT NULL,
	`is_local` integer DEFAULT false NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `errors` (
	`event_id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`message` text NOT NULL,
	`retryable` integer NOT NULL,
	`details_schema_id` text,
	`details_json` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `event_artifacts` (
	`event_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`relationship` text NOT NULL,
	PRIMARY KEY(`event_id`, `artifact_id`, `relationship`),
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_artifacts_relationship_valid" CHECK("event_artifacts"."relationship" in ('input', 'output', 'attachment', 'preview'))
);
--> statement-breakpoint
CREATE TABLE `file_artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`mime_type` text NOT NULL,
	`content_sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`availability` text DEFAULT 'local' NOT NULL,
	`local_relative_path` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "file_artifacts_hash_valid" CHECK(length("file_artifacts"."content_sha256") = 64 and "file_artifacts"."content_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "file_artifacts_size_valid" CHECK("file_artifacts"."byte_size" >= 0),
	CONSTRAINT "file_artifacts_location_matches_availability" CHECK((
        ("file_artifacts"."availability" = 'local' and "file_artifacts"."local_relative_path" is not null)
        or
        ("file_artifacts"."availability" in ('remote_only', 'missing') and "file_artifacts"."local_relative_path" is null)
      ))
);
--> statement-breakpoint
CREATE TABLE `link_artifacts` (
	`artifact_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `local_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`origin_client_instance_id` text NOT NULL,
	`session_id` text NOT NULL,
	`session_revision` integer NOT NULL,
	`event_id` text,
	`kind` text NOT NULL,
	`payload_schema_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "local_changes_kind_valid" CHECK("local_changes"."kind" in ('session.upsert', 'session.event.append', 'session.delete')),
	CONSTRAINT "local_changes_payload_schema_version_positive" CHECK("local_changes"."payload_schema_version" > 0),
	CONSTRAINT "local_changes_hash_valid" CHECK(length("local_changes"."payload_sha256") = 64 and "local_changes"."payload_sha256" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_changes_session_revision_uq` ON `local_changes` (`session_id`,`session_revision`);--> statement-breakpoint
CREATE UNIQUE INDEX `local_changes_event_uq` ON `local_changes` (`event_id`) WHERE "local_changes"."event_id" is not null;--> statement-breakpoint
CREATE INDEX `local_changes_created_at_idx` ON `local_changes` (`created_at_ms`);--> statement-breakpoint
CREATE TABLE `message_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`message_event_id` text NOT NULL,
	`position` integer NOT NULL,
	`part_type` text NOT NULL,
	`text_content` text,
	`artifact_id` text,
	FOREIGN KEY (`message_event_id`) REFERENCES `messages`(`event_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "message_parts_position_valid" CHECK("message_parts"."position" >= 0),
	CONSTRAINT "message_parts_value_matches_type" CHECK((
        ("message_parts"."part_type" = 'text' and "message_parts"."text_content" is not null and "message_parts"."artifact_id" is null)
        or
        ("message_parts"."part_type" = 'artifact_reference' and "message_parts"."text_content" is null and "message_parts"."artifact_id" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `message_parts_position_uq` ON `message_parts` (`message_event_id`,`position`);--> statement-breakpoint
CREATE TABLE `messages` (
	`event_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`provider_message_id` text,
	`finish_reason` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role_valid" CHECK("messages"."role" in ('user', 'assistant', 'system')),
	CONSTRAINT "messages_status_valid" CHECK("messages"."status" in ('completed', 'cancelled', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `reasoning_summaries` (
	`event_id` text PRIMARY KEY NOT NULL,
	`summary_text` text NOT NULL,
	`summary_kind` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reasoning_summaries_text_nonempty" CHECK(length(trim("reasoning_summaries"."summary_text")) > 0),
	CONSTRAINT "reasoning_summaries_kind_valid" CHECK("reasoning_summaries"."summary_kind" in ('analysis', 'decision', 'handoff'))
);
--> statement-breakpoint
CREATE TABLE `session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`session_revision` integer NOT NULL,
	`event_type` text NOT NULL,
	`source_client_instance_id` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "session_events_revision_positive" CHECK("session_events"."session_revision" > 0),
	CONSTRAINT "session_events_type_valid" CHECK("session_events"."event_type" in ('message', 'reasoning_summary', 'task_plan', 'task_step_update', 'tool_call', 'tool_result', 'approval_request', 'approval_decision', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_revision_uq` ON `session_events` (`session_id`,`session_revision`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`origin_client_instance_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`archived_at_ms` integer,
	`deleted_at_ms` integer,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sessions_title_nonempty" CHECK(length(trim("sessions"."title")) > 0),
	CONSTRAINT "sessions_revision_positive" CHECK("sessions"."revision" > 0),
	CONSTRAINT "sessions_updated_after_created" CHECK("sessions"."updated_at_ms" >= "sessions"."created_at_ms"),
	CONSTRAINT "sessions_archived_after_created" CHECK("sessions"."archived_at_ms" is null or "sessions"."archived_at_ms" >= "sessions"."created_at_ms"),
	CONSTRAINT "sessions_deleted_after_created" CHECK("sessions"."deleted_at_ms" is null or "sessions"."deleted_at_ms" >= "sessions"."created_at_ms"),
	CONSTRAINT "sessions_status_valid" CHECK("sessions"."status" in ('active', 'completed', 'cancelled', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `sessions_updated_at_idx` ON `sessions` (`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `sync_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_key` text NOT NULL,
	`endpoint_url` text NOT NULL,
	`credential_ref` text,
	`remote_subject` text,
	`account_label` text,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_connections_provider_endpoint_uq` ON `sync_connections` (`provider_key`,`endpoint_url`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`connection_id` text NOT NULL,
	`stream` text NOT NULL,
	`pull_cursor` text,
	`last_pull_at_ms` integer,
	`last_success_at_ms` integer,
	PRIMARY KEY(`connection_id`, `stream`),
	FOREIGN KEY (`connection_id`) REFERENCES `sync_connections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sync_deliveries` (
	`connection_id` text NOT NULL,
	`change_id` text NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at_ms` integer,
	`acked_at_ms` integer,
	`last_error_code` text,
	PRIMARY KEY(`connection_id`, `change_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `sync_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`change_id`) REFERENCES `local_changes`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sync_deliveries_state_valid" CHECK("sync_deliveries"."state" in ('pending', 'in_flight', 'acked', 'rejected')),
	CONSTRAINT "sync_deliveries_attempts_valid" CHECK("sync_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sync_deliveries_claim_idx` ON `sync_deliveries` (`connection_id`,`state`,`next_attempt_at_ms`);--> statement-breakpoint
CREATE TABLE `sync_inbox` (
	`connection_id` text NOT NULL,
	`remote_change_id` text NOT NULL,
	`payload_sha256` text NOT NULL,
	`received_at_ms` integer NOT NULL,
	`applied_at_ms` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `remote_change_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `sync_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sync_inbox_hash_valid" CHECK(length("sync_inbox"."payload_sha256") = 64 and "sync_inbox"."payload_sha256" not glob '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `task_plan_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `task_plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_plan_events_plan_id_unique` ON `task_plan_events` (`plan_id`);--> statement-breakpoint
CREATE TABLE `task_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`supersedes_plan_id` text,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supersedes_plan_id`) REFERENCES `task_plans`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "task_plans_title_nonempty" CHECK(length(trim("task_plans"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE `task_step_updates` (
	`event_id` text PRIMARY KEY NOT NULL,
	`task_step_id` text NOT NULL,
	`state` text NOT NULL,
	`detail` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_step_id`) REFERENCES `task_steps`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_step_updates_state_valid" CHECK("task_step_updates"."state" in ('pending', 'in_progress', 'completed', 'blocked', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE `task_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `task_plans`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "task_steps_position_valid" CHECK("task_steps"."position" >= 0),
	CONSTRAINT "task_steps_title_nonempty" CHECK(length(trim("task_steps"."title")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_steps_position_uq` ON `task_steps` (`plan_id`,`position`);--> statement-breakpoint
CREATE TABLE `tool_calls` (
	`event_id` text PRIMARY KEY NOT NULL,
	`triggering_message_event_id` text,
	`capability` text NOT NULL,
	`operation` text NOT NULL,
	`input_schema_id` text NOT NULL,
	`input_schema_version` integer NOT NULL,
	`input_json` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`triggering_message_event_id`) REFERENCES `messages`(`event_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tool_calls_input_schema_version_positive" CHECK("tool_calls"."input_schema_version" > 0)
);
--> statement-breakpoint
CREATE TABLE `tool_results` (
	`event_id` text PRIMARY KEY NOT NULL,
	`tool_call_event_id` text NOT NULL,
	`outcome` text NOT NULL,
	`output_schema_id` text NOT NULL,
	`output_schema_version` integer NOT NULL,
	`output_json` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_event_id`) REFERENCES `tool_calls`(`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tool_results_outcome_valid" CHECK("tool_results"."outcome" in ('succeeded', 'failed', 'cancelled')),
	CONSTRAINT "tool_results_output_schema_version_positive" CHECK("tool_results"."output_schema_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_results_call_uq` ON `tool_results` (`tool_call_event_id`);