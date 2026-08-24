CREATE TABLE `agent_run_presentations` (
	`event_id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`mode` text NOT NULL,
	`initial_state` text,
	`summary_message_event_id` text,
	`label` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`summary_message_event_id`) REFERENCES `messages`(`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_run_presentations_mode_valid" CHECK("agent_run_presentations"."mode" in ('inline', 'collapsible')),
	CONSTRAINT "agent_run_presentations_state_matches_mode" CHECK((
        ("agent_run_presentations"."mode" = 'inline' and "agent_run_presentations"."initial_state" is null)
        or
        ("agent_run_presentations"."mode" = 'collapsible' and "agent_run_presentations"."initial_state" in ('expanded', 'collapsed'))
      )),
	CONSTRAINT "agent_run_presentations_label_valid" CHECK("agent_run_presentations"."label" is null or (length(trim("agent_run_presentations"."label")) > 0 and length("agent_run_presentations"."label") <= 80))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_presentations_agent_run_id_unique` ON `agent_run_presentations` (`agent_run_id`);--> statement-breakpoint
CREATE TABLE `agent_run_state_updates` (
	`event_id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	`state` text NOT NULL,
	`detail` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_run_state_updates_state_valid" CHECK("agent_run_state_updates"."state" in ('working', 'waiting_for_approval', 'waiting_for_user', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`created_by_event_id` text NOT NULL,
	`provider_key` text NOT NULL,
	`provider_run_id` text,
	`triggering_message_event_id` text,
	`started_at_ms` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`triggering_message_event_id`) REFERENCES `messages`(`event_id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "agent_runs_provider_key_nonempty" CHECK(length(trim("agent_runs"."provider_key")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_created_by_event_id_unique` ON `agent_runs` (`created_by_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_provider_run_uq` ON `agent_runs` (`provider_key`,`provider_run_id`) WHERE "agent_runs"."provider_run_id" is not null;--> statement-breakpoint
CREATE INDEX `agent_runs_session_started_idx` ON `agent_runs` (`session_id`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `event_runs` (
	`event_id` text PRIMARY KEY NOT NULL,
	`agent_run_id` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `file_changes` (
	`event_id` text PRIMARY KEY NOT NULL,
	`project_file_id` text NOT NULL,
	`tool_call_event_id` text,
	`operation` text NOT NULL,
	`before_version_id` text,
	`after_version_id` text,
	`text_additions` integer,
	`text_deletions` integer,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tool_call_event_id`) REFERENCES `tool_calls`(`event_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`before_version_id`) REFERENCES `project_file_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`after_version_id`) REFERENCES `project_file_versions`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "file_changes_operation_valid" CHECK("file_changes"."operation" in ('create', 'modify', 'relocate', 'delete')),
	CONSTRAINT "file_changes_versions_match_operation" CHECK((
        ("file_changes"."operation" = 'create' and "file_changes"."before_version_id" is null and "file_changes"."after_version_id" is not null)
        or
        ("file_changes"."operation" in ('modify', 'relocate') and "file_changes"."before_version_id" is not null and "file_changes"."after_version_id" is not null)
        or
        ("file_changes"."operation" = 'delete' and "file_changes"."before_version_id" is not null and "file_changes"."after_version_id" is null)
      )),
	CONSTRAINT "file_changes_text_diff_paired" CHECK((
        ("file_changes"."text_additions" is null and "file_changes"."text_deletions" is null)
        or
        ("file_changes"."text_additions" >= 0 and "file_changes"."text_deletions" >= 0)
      ))
);
--> statement-breakpoint
CREATE INDEX `file_changes_file_idx` ON `file_changes` (`project_file_id`);--> statement-breakpoint
CREATE TABLE `project_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_file_id` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`content_sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`availability` text DEFAULT 'local' NOT NULL,
	`local_relative_path` text,
	`captured_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "project_file_versions_path_valid" CHECK(length(trim("project_file_versions"."relative_path")) > 0 and "project_file_versions"."relative_path" not like '/%' and instr("project_file_versions"."relative_path", '\') = 0),
	CONSTRAINT "project_file_versions_hash_valid" CHECK(length("project_file_versions"."content_sha256") = 64 and "project_file_versions"."content_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "project_file_versions_size_valid" CHECK("project_file_versions"."byte_size" >= 0),
	CONSTRAINT "project_file_versions_location_matches_availability" CHECK((
        ("project_file_versions"."availability" = 'local' and "project_file_versions"."local_relative_path" is not null)
        or
        ("project_file_versions"."availability" = 'missing' and "project_file_versions"."local_relative_path" is null)
      ))
);
--> statement-breakpoint
CREATE INDEX `project_file_versions_file_captured_idx` ON `project_file_versions` (`project_file_id`,`captured_at_ms`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `project_files_project_idx` ON `project_files` (`project_id`);--> statement-breakpoint
CREATE TABLE `tool_progress_events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`tool_call_event_id` text NOT NULL,
	`progress_schema_id` text NOT NULL,
	`progress_schema_version` integer NOT NULL,
	`progress_json` text NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tool_call_event_id`) REFERENCES `tool_calls`(`event_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tool_progress_events_schema_version_positive" CHECK("tool_progress_events"."progress_schema_version" > 0)
);
--> statement-breakpoint
CREATE INDEX `tool_progress_events_call_idx` ON `tool_progress_events` (`tool_call_event_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_session_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`session_revision` integer NOT NULL,
	`event_type` text NOT NULL,
	`source_client_instance_id` text NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "session_events_revision_positive" CHECK("__new_session_events"."session_revision" > 0),
	CONSTRAINT "session_events_type_valid" CHECK("__new_session_events"."event_type" in ('message', 'agent_run', 'agent_run_state_update', 'agent_run_presentation', 'reasoning_summary', 'task_plan', 'task_step_update', 'tool_call', 'tool_progress', 'tool_result', 'file_change', 'approval_request', 'approval_decision', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_session_events`("id", "session_id", "session_revision", "event_type", "source_client_instance_id", "occurred_at_ms") SELECT "id", "session_id", "session_revision", "event_type", "source_client_instance_id", "occurred_at_ms" FROM `session_events`;--> statement-breakpoint
DROP TABLE `session_events`;--> statement-breakpoint
ALTER TABLE `__new_session_events` RENAME TO `session_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `session_events_revision_uq` ON `session_events` (`session_id`,`session_revision`);--> statement-breakpoint
CREATE TABLE `__new_messages` (
	`event_id` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`message_kind` text NOT NULL,
	`status` text NOT NULL,
	`model` text,
	`provider_message_id` text,
	`finish_reason` text,
	FOREIGN KEY (`event_id`) REFERENCES `session_events`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "messages_role_valid" CHECK("__new_messages"."role" in ('user', 'assistant', 'system')),
	CONSTRAINT "messages_status_valid" CHECK("__new_messages"."status" in ('completed', 'cancelled', 'failed')),
	CONSTRAINT "messages_kind_valid" CHECK("__new_messages"."message_kind" in ('prompt', 'progress', 'final', 'run_summary', 'system_notice'))
);
--> statement-breakpoint
INSERT INTO `__new_messages`("event_id", "role", "message_kind", "status", "model", "provider_message_id", "finish_reason") SELECT "event_id", "role", CASE "role" WHEN 'user' THEN 'prompt' WHEN 'system' THEN 'system_notice' ELSE 'final' END, "status", "model", "provider_message_id", "finish_reason" FROM `messages`;--> statement-breakpoint
DROP TABLE `messages`;--> statement-breakpoint
ALTER TABLE `__new_messages` RENAME TO `messages`;
