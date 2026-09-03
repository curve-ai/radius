CREATE SCHEMA "radius_sync";
--> statement-breakpoint
CREATE TABLE "radius_sync"."artifacts" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"artifact_type" text NOT NULL,
	"storage_kind" text NOT NULL,
	"supersedes_artifact_id" uuid,
	"created_by_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sync_artifacts_identity_key" UNIQUE("artifact_id","organization_id"),
	CONSTRAINT "sync_artifacts_membership_identity_key" UNIQUE("membership_id","artifact_id"),
	CONSTRAINT "sync_artifacts_storage_kind_check" CHECK ("radius_sync"."artifacts"."storage_kind" IN ('file', 'link'))
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."event_artifacts" (
	"event_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	CONSTRAINT "event_artifacts_event_id_artifact_id_relationship_pk" PRIMARY KEY("event_id","artifact_id","relationship"),
	CONSTRAINT "sync_event_artifacts_relationship_check" CHECK ("radius_sync"."event_artifacts"."relationship" IN ('input', 'output', 'attachment', 'preview'))
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."file_artifacts" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"availability" text DEFAULT 'metadata_only' NOT NULL,
	"remote_locator" text,
	CONSTRAINT "sync_file_artifacts_digest_check" CHECK ("radius_sync"."file_artifacts"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sync_file_artifacts_size_check" CHECK ("radius_sync"."file_artifacts"."byte_size" >= 0),
	CONSTRAINT "sync_file_artifacts_availability_check" CHECK ("radius_sync"."file_artifacts"."availability" IN ('metadata_only', 'available'))
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."link_artifacts" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"provider" text NOT NULL,
	"external_id" text
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."changes" (
	"change_sequence" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "radius_sync"."changes_change_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"project_id" uuid,
	"project_revision" bigint,
	"session_id" uuid,
	"session_revision" bigint,
	"kind" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sync_changes_subject_check" CHECK (num_nonnulls("radius_sync"."changes"."project_id", "radius_sync"."changes"."session_id") = 1),
	CONSTRAINT "sync_changes_project_revision_check" CHECK (("radius_sync"."changes"."project_id" IS NULL) = ("radius_sync"."changes"."project_revision" IS NULL)),
	CONSTRAINT "sync_changes_session_revision_check" CHECK (("radius_sync"."changes"."session_id" IS NULL) = ("radius_sync"."changes"."session_revision" IS NULL)),
	CONSTRAINT "sync_changes_digest_check" CHECK ("radius_sync"."changes"."payload_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."devices" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"client_installation_id" uuid,
	"display_name" text NOT NULL,
	"platform" text NOT NULL,
	"public_key_jwk" jsonb NOT NULL,
	"app_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sync_devices_identity_key" UNIQUE("device_id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."projects" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sync_projects_identity_key" UNIQUE("project_id","organization_id"),
	CONSTRAINT "sync_projects_membership_identity_key" UNIQUE("membership_id","project_id"),
	CONSTRAINT "sync_projects_revision_check" CHECK ("radius_sync"."projects"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "sync_sessions_identity_key" UNIQUE("session_id","organization_id"),
	CONSTRAINT "sync_sessions_membership_identity_key" UNIQUE("membership_id","session_id"),
	CONSTRAINT "sync_sessions_status_check" CHECK ("radius_sync"."sessions"."status" IN ('active', 'completed', 'cancelled', 'failed')),
	CONSTRAINT "sync_sessions_revision_check" CHECK ("radius_sync"."sessions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."agent_run_presentations" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"initial_state" text,
	"summary_message_event_id" uuid,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."agent_run_state_updates" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"state" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."agent_runs" (
	"agent_run_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"provider_run_id" text,
	"triggering_message_event_id" uuid,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."approval_decisions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"approval_request_event_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."approval_requests" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tool_call_event_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."errors" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"retryable" boolean NOT NULL,
	"details_schema_id" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."message_parts" (
	"part_id" uuid PRIMARY KEY NOT NULL,
	"message_event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"part_type" text NOT NULL,
	"text" text,
	"artifact_id" uuid
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."messages" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"message_kind" text NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"provider_message_id" text,
	"finish_reason" text
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."reasoning_summaries" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"summary_kind" text NOT NULL,
	"summary_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."session_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_revision" integer NOT NULL,
	"event_type" text NOT NULL,
	"agent_run_id" uuid,
	"source_client_instance_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."task_plans" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"supersedes_plan_id" uuid,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."task_step_updates" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"task_step_id" uuid NOT NULL,
	"state" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."task_steps" (
	"task_step_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."tool_calls" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"triggering_message_event_id" uuid,
	"capability" text NOT NULL,
	"operation" text NOT NULL,
	"input_schema_id" text NOT NULL,
	"input_schema_version" integer NOT NULL,
	"input" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."tool_progress_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tool_call_event_id" uuid NOT NULL,
	"progress_schema_id" text NOT NULL,
	"progress_schema_version" integer NOT NULL,
	"progress" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."tool_results" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"tool_call_event_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"output_schema_id" text,
	"output_schema_version" integer,
	"output" jsonb
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."file_changes" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_file_id" uuid NOT NULL,
	"tool_call_event_id" uuid,
	"operation" text NOT NULL,
	"before_version_id" uuid,
	"after_version_id" uuid,
	"text_diff" jsonb
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."project_file_versions" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"project_file_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"availability" text DEFAULT 'metadata_only' NOT NULL,
	CONSTRAINT "sync_project_file_versions_identity_key" UNIQUE("version_id","organization_id"),
	CONSTRAINT "sync_project_file_versions_digest_check" CHECK ("radius_sync"."project_file_versions"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "sync_project_file_versions_size_check" CHECK ("radius_sync"."project_file_versions"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "radius_sync"."project_files" (
	"project_file_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_project_files_identity_key" UNIQUE("project_file_id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "radius_sync"."artifacts" ADD CONSTRAINT "artifacts_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."artifacts" ADD CONSTRAINT "artifacts_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "radius_sync"."sessions"("session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."artifacts" ADD CONSTRAINT "artifacts_created_by_event_id_session_events_event_id_fk" FOREIGN KEY ("created_by_event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."event_artifacts" ADD CONSTRAINT "event_artifacts_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."event_artifacts" ADD CONSTRAINT "event_artifacts_artifact_id_artifacts_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "radius_sync"."artifacts"("artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_artifacts" ADD CONSTRAINT "file_artifacts_artifact_id_artifacts_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "radius_sync"."artifacts"("artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_artifacts" ADD CONSTRAINT "file_artifacts_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."link_artifacts" ADD CONSTRAINT "link_artifacts_artifact_id_artifacts_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "radius_sync"."artifacts"("artifact_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."changes" ADD CONSTRAINT "changes_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."changes" ADD CONSTRAINT "changes_origin_device_id_devices_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "radius_sync"."devices"("device_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."changes" ADD CONSTRAINT "sync_changes_membership_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "radius_platform"."organization_memberships"("membership_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."devices" ADD CONSTRAINT "devices_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."devices" ADD CONSTRAINT "sync_devices_membership_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "radius_platform"."organization_memberships"("membership_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."projects" ADD CONSTRAINT "projects_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."projects" ADD CONSTRAINT "projects_origin_device_id_devices_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "radius_sync"."devices"("device_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."projects" ADD CONSTRAINT "sync_projects_membership_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "radius_platform"."organization_memberships"("membership_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."sessions" ADD CONSTRAINT "sessions_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."sessions" ADD CONSTRAINT "sessions_origin_device_id_devices_device_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "radius_sync"."devices"("device_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."sessions" ADD CONSTRAINT "sessions_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "radius_sync"."projects"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."sessions" ADD CONSTRAINT "sync_sessions_membership_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "radius_platform"."organization_memberships"("membership_id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."agent_run_presentations" ADD CONSTRAINT "agent_run_presentations_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."agent_run_presentations" ADD CONSTRAINT "agent_run_presentations_agent_run_id_agent_runs_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "radius_sync"."agent_runs"("agent_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."agent_run_state_updates" ADD CONSTRAINT "agent_run_state_updates_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."agent_run_state_updates" ADD CONSTRAINT "agent_run_state_updates_agent_run_id_agent_runs_agent_run_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "radius_sync"."agent_runs"("agent_run_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."agent_runs" ADD CONSTRAINT "agent_runs_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."agent_runs" ADD CONSTRAINT "agent_runs_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "radius_sync"."sessions"("session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."approval_decisions" ADD CONSTRAINT "approval_decisions_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_event_id_approval_requests_event_id_fk" FOREIGN KEY ("approval_request_event_id") REFERENCES "radius_sync"."approval_requests"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."approval_requests" ADD CONSTRAINT "approval_requests_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."approval_requests" ADD CONSTRAINT "approval_requests_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "radius_sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."errors" ADD CONSTRAINT "errors_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."message_parts" ADD CONSTRAINT "message_parts_message_event_id_messages_event_id_fk" FOREIGN KEY ("message_event_id") REFERENCES "radius_sync"."messages"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."messages" ADD CONSTRAINT "messages_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."reasoning_summaries" ADD CONSTRAINT "reasoning_summaries_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."session_events" ADD CONSTRAINT "session_events_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."session_events" ADD CONSTRAINT "session_events_session_id_sessions_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "radius_sync"."sessions"("session_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."session_events" ADD CONSTRAINT "session_events_source_client_instance_id_devices_device_id_fk" FOREIGN KEY ("source_client_instance_id") REFERENCES "radius_sync"."devices"("device_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."task_plans" ADD CONSTRAINT "task_plans_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."task_step_updates" ADD CONSTRAINT "task_step_updates_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."task_step_updates" ADD CONSTRAINT "task_step_updates_task_step_id_task_steps_task_step_id_fk" FOREIGN KEY ("task_step_id") REFERENCES "radius_sync"."task_steps"("task_step_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."task_steps" ADD CONSTRAINT "task_steps_plan_id_task_plans_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "radius_sync"."task_plans"("plan_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."tool_calls" ADD CONSTRAINT "tool_calls_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."tool_progress_events" ADD CONSTRAINT "tool_progress_events_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."tool_progress_events" ADD CONSTRAINT "tool_progress_events_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "radius_sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."tool_results" ADD CONSTRAINT "tool_results_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."tool_results" ADD CONSTRAINT "tool_results_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "radius_sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_changes" ADD CONSTRAINT "file_changes_event_id_session_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "radius_sync"."session_events"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_changes" ADD CONSTRAINT "file_changes_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "radius_sync"."projects"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_changes" ADD CONSTRAINT "file_changes_project_file_id_project_files_project_file_id_fk" FOREIGN KEY ("project_file_id") REFERENCES "radius_sync"."project_files"("project_file_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_changes" ADD CONSTRAINT "file_changes_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "radius_sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_changes" ADD CONSTRAINT "file_changes_before_version_id_project_file_versions_version_id_fk" FOREIGN KEY ("before_version_id") REFERENCES "radius_sync"."project_file_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."file_changes" ADD CONSTRAINT "file_changes_after_version_id_project_file_versions_version_id_fk" FOREIGN KEY ("after_version_id") REFERENCES "radius_sync"."project_file_versions"("version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."project_file_versions" ADD CONSTRAINT "project_file_versions_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."project_file_versions" ADD CONSTRAINT "project_file_versions_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "radius_sync"."projects"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."project_file_versions" ADD CONSTRAINT "project_file_versions_project_file_id_project_files_project_file_id_fk" FOREIGN KEY ("project_file_id") REFERENCES "radius_sync"."project_files"("project_file_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."project_files" ADD CONSTRAINT "project_files_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_sync"."project_files" ADD CONSTRAINT "project_files_project_id_projects_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "radius_sync"."projects"("project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_file_artifacts_content_idx" ON "radius_sync"."file_artifacts" USING btree ("membership_id","content_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_changes_membership_change_key" ON "radius_sync"."changes" USING btree ("membership_id","change_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_changes_membership_project_revision_key" ON "radius_sync"."changes" USING btree ("membership_id","project_id","project_revision") WHERE "radius_sync"."changes"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_changes_membership_session_revision_key" ON "radius_sync"."changes" USING btree ("membership_id","session_id","session_revision") WHERE "radius_sync"."changes"."session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sync_changes_membership_sequence_idx" ON "radius_sync"."changes" USING btree ("membership_id","change_sequence");--> statement-breakpoint
CREATE INDEX "sync_devices_membership_revoked_idx" ON "radius_sync"."devices" USING btree ("membership_id","revoked_at");--> statement-breakpoint
CREATE INDEX "sync_projects_membership_updated_idx" ON "radius_sync"."projects" USING btree ("membership_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_sessions_membership_project_updated_idx" ON "radius_sync"."sessions" USING btree ("membership_id","project_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_sessions_membership_updated_idx" ON "radius_sync"."sessions" USING btree ("membership_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_sessions_organization_updated_idx" ON "radius_sync"."sessions" USING btree ("organization_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "sync_agent_run_presentations_run_key" ON "radius_sync"."agent_run_presentations" USING btree ("agent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_agent_runs_event_key" ON "radius_sync"."agent_runs" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_agent_runs_provider_run_key" ON "radius_sync"."agent_runs" USING btree ("provider_key","provider_run_id") WHERE "radius_sync"."agent_runs"."provider_run_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sync_agent_runs_session_started_idx" ON "radius_sync"."agent_runs" USING btree ("session_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_approval_decisions_request_key" ON "radius_sync"."approval_decisions" USING btree ("approval_request_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_approval_requests_call_key" ON "radius_sync"."approval_requests" USING btree ("tool_call_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_message_parts_position_key" ON "radius_sync"."message_parts" USING btree ("message_event_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_session_events_membership_event_key" ON "radius_sync"."session_events" USING btree ("membership_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_session_events_membership_session_revision_key" ON "radius_sync"."session_events" USING btree ("membership_id","session_id","session_revision");--> statement-breakpoint
CREATE INDEX "sync_session_events_run_occurred_idx" ON "radius_sync"."session_events" USING btree ("membership_id","agent_run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sync_session_events_organization_occurred_idx" ON "radius_sync"."session_events" USING btree ("organization_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_task_plans_event_key" ON "radius_sync"."task_plans" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_task_steps_position_key" ON "radius_sync"."task_steps" USING btree ("plan_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_tool_results_call_key" ON "radius_sync"."tool_results" USING btree ("tool_call_event_id");--> statement-breakpoint
CREATE INDEX "sync_file_changes_run_idx" ON "radius_sync"."file_changes" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "sync_file_changes_file_idx" ON "radius_sync"."file_changes" USING btree ("project_file_id");--> statement-breakpoint
CREATE INDEX "sync_project_file_versions_file_captured_idx" ON "radius_sync"."project_file_versions" USING btree ("membership_id","project_file_id","captured_at");--> statement-breakpoint
CREATE INDEX "sync_project_files_membership_project_idx" ON "radius_sync"."project_files" USING btree ("membership_id","project_id");