CREATE SCHEMA IF NOT EXISTS "auth";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "platform";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "sync";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "connectors";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "audit";
--> statement-breakpoint
CREATE TABLE "audit"."events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_membership_id" uuid,
	"actor_type" text NOT NULL,
	"event_type" text NOT NULL,
	"subject_kind" text NOT NULL,
	"subject_id" uuid,
	"detail" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth"."rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth"."user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "auth"."verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connectors"."catalog_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_server_name" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"version" text NOT NULL,
	"transport" text NOT NULL,
	"remote_url" text NOT NULL,
	"repository_url" text,
	"website_url" text,
	"domain" text,
	"logo_url" text,
	"source_status" text DEFAULT 'active' NOT NULL,
	"published_at" timestamp with time zone,
	"registry_updated_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "connector_catalog_source_name_uq" UNIQUE("source","source_server_name")
);
--> statement-breakpoint
CREATE TABLE "connectors"."catalog_ingestion_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"upserted" integer DEFAULT 0 NOT NULL,
	"deleted" integer DEFAULT 0 NOT NULL,
	"logos_queued" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "connector_catalog_runs_counts_nonnegative_ck" CHECK ("connectors"."catalog_ingestion_runs"."fetched" >= 0 AND "connectors"."catalog_ingestion_runs"."upserted" >= 0 AND "connectors"."catalog_ingestion_runs"."deleted" >= 0 AND "connectors"."catalog_ingestion_runs"."logos_queued" >= 0)
);
--> statement-breakpoint
CREATE TABLE "connectors"."logo_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"r2_key" text,
	"public_url" text,
	"content_type" text,
	"byte_size" bigint,
	"sha256" text,
	"source_url" text,
	"fetched_at" timestamp with time zone,
	"unavailable_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_logo_assets_domain_uq" UNIQUE("domain"),
	CONSTRAINT "connector_logo_assets_r2_key_uq" UNIQUE("r2_key"),
	CONSTRAINT "connector_logo_assets_domain_normalized_ck" CHECK ("connectors"."logo_assets"."domain" = lower("connectors"."logo_assets"."domain"))
);
--> statement-breakpoint
CREATE TABLE "connectors"."profile_changes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connectors"."profile_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload_schema_version" integer NOT NULL,
	"payload_sha256" text NOT NULL,
	"change" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_changes_account_change_uq" UNIQUE("account_id","change_id")
);
--> statement-breakpoint
CREATE TABLE "connectors"."profile_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"profile_connector_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"endpoint_key" text NOT NULL,
	"account_label" text,
	"remote_subject" text,
	"origin_device_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profile_connections_account_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "profile_connections_revision_positive_ck" CHECK ("connectors"."profile_connections"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "connectors"."profile_connectors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"connector_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"release_selection_mode" text NOT NULL,
	"release_selection_value" text NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profile_connectors_account_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "profile_connectors_revision_positive_ck" CHECK ("connectors"."profile_connectors"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."credential_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"external_reference" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"rotated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_references_org_external_uq" UNIQUE("organization_id","provider_key","external_reference")
);
--> statement-breakpoint
CREATE TABLE "platform"."deployment_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"action" text NOT NULL,
	"changed_by_membership_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployment_revisions_deployment_revision_uq" UNIQUE("deployment_id","revision")
);
--> statement-breakpoint
CREATE TABLE "platform"."deployments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deployments_environment_uq" UNIQUE("environment_id"),
	CONSTRAINT "deployments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "deployments_revision_positive_ck" CHECK ("platform"."deployments"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_account_id" uuid NOT NULL,
	"client_instance_id" uuid NOT NULL,
	"public_key_jwk" jsonb NOT NULL,
	"display_name" text NOT NULL,
	"platform" text NOT NULL,
	"app_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_client_instance_id_unique" UNIQUE("client_instance_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."environments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_project_key_uq" UNIQUE("project_id","key"),
	CONSTRAINT "environments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "environments_org_id_project_uq" UNIQUE("organization_id","id","project_id"),
	CONSTRAINT "environments_key_normalized_ck" CHECK ("platform"."environments"."key" = lower("platform"."environments"."key"))
);
--> statement-breakpoint
CREATE TABLE "platform"."group_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "group_assignments_environment_group_uq" UNIQUE("environment_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."group_memberships" (
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_membership_id_pk" PRIMARY KEY("group_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."installation_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"observed_state" text NOT NULL,
	"health" text NOT NULL,
	"detail" jsonb,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."membership_roles" (
	"organization_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_membership_id_role_id_pk" PRIMARY KEY("membership_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."organization_devices" (
	"organization_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "organization_devices_organization_id_device_id_pk" PRIMARY KEY("organization_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."organization_domains" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"domain_kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_domains_hostname_uq" UNIQUE("hostname"),
	CONSTRAINT "organization_domains_hostname_normalized_ck" CHECK ("platform"."organization_domains"."hostname" = lower("platform"."organization_domains"."hostname"))
);
--> statement-breakpoint
CREATE TABLE "platform"."organization_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_groups_org_name_uq" UNIQUE("organization_id","name"),
	CONSTRAINT "organization_groups_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "platform"."organization_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_org_account_uq" UNIQUE("organization_id","account_id"),
	CONSTRAINT "organization_memberships_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "platform"."organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_uq" UNIQUE("slug"),
	CONSTRAINT "organizations_id_tenant_uq" UNIQUE("id","slug"),
	CONSTRAINT "organizations_slug_normalized_ck" CHECK ("platform"."organizations"."slug" = lower("platform"."organizations"."slug")),
	CONSTRAINT "organizations_slug_format_ck" CHECK ("platform"."organizations"."slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$')
);
--> statement-breakpoint
CREATE TABLE "platform"."accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policies_org_key_uq" UNIQUE("organization_id","key"),
	CONSTRAINT "policies_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "platform"."policy_device_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "policy_device_assignments_active_uq" UNIQUE("policy_revision_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."policy_group_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "policy_group_assignments_active_uq" UNIQUE("policy_revision_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."policy_membership_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "policy_membership_assignments_active_uq" UNIQUE("policy_revision_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."policy_project_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "policy_project_assignments_active_uq" UNIQUE("policy_revision_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."policy_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"document" jsonb NOT NULL,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_revisions_policy_revision_uq" UNIQUE("policy_id","revision"),
	CONSTRAINT "policy_revisions_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "platform"."projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_org_slug_uq" UNIQUE("organization_id","slug"),
	CONSTRAINT "projects_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "projects_slug_normalized_ck" CHECK ("platform"."projects"."slug" = lower("platform"."projects"."slug")),
	CONSTRAINT "projects_revision_positive_ck" CHECK ("platform"."projects"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."release_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"artifact_kind" text NOT NULL,
	"digest_algorithm" text NOT NULL,
	"digest" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"storage_provider" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "release_artifacts_release_kind_uq" UNIQUE("release_id","artifact_kind"),
	CONSTRAINT "release_artifacts_digest_uq" UNIQUE("digest_algorithm","digest"),
	CONSTRAINT "release_artifacts_byte_size_nonnegative_ck" CHECK ("platform"."release_artifacts"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "platform"."release_revocations" (
	"release_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"revoked_by_membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform"."releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"version" text NOT NULL,
	"content_digest" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"contract_version" text NOT NULL,
	"created_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "releases_project_version_uq" UNIQUE("project_id","version"),
	CONSTRAINT "releases_project_digest_uq" UNIQUE("project_id","content_digest"),
	CONSTRAINT "releases_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "releases_org_id_project_uq" UNIQUE("organization_id","id","project_id")
);
--> statement-breakpoint
CREATE TABLE "platform"."role_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"display_name" text NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_definitions_key_uq" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "platform"."user_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_assignments_environment_membership_uq" UNIQUE("environment_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."agent_run_presentations" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"initial_state" text,
	"summary_message_event_id" uuid,
	"label" text,
	CONSTRAINT "agent_run_presentations_agent_run_id_unique" UNIQUE("agent_run_id"),
	CONSTRAINT "sync_agent_run_presentations_mode_ck" CHECK ("sync"."agent_run_presentations"."mode" in ('inline', 'collapsible')),
	CONSTRAINT "sync_agent_run_presentations_state_matches_mode_ck" CHECK ((
        ("sync"."agent_run_presentations"."mode" = 'inline' and "sync"."agent_run_presentations"."initial_state" is null)
        or
        ("sync"."agent_run_presentations"."mode" = 'collapsible' and "sync"."agent_run_presentations"."initial_state" in ('expanded', 'collapsed'))
      )),
	CONSTRAINT "sync_agent_run_presentations_label_ck" CHECK ("sync"."agent_run_presentations"."label" is null or (length(trim("sync"."agent_run_presentations"."label")) > 0 and length("sync"."agent_run_presentations"."label") <= 80))
);
--> statement-breakpoint
CREATE TABLE "sync"."agent_run_state_updates" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"state" text NOT NULL,
	"detail" text,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"provider_key" text NOT NULL,
	"provider_run_id" text,
	"triggering_message_event_id" uuid,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_runs_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "sync_agent_runs_account_provider_run_uq" UNIQUE("account_id","provider_key","provider_run_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."approval_decisions" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"approval_request_event_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"note" text,
	CONSTRAINT "approval_decisions_approval_request_event_id_unique" UNIQUE("approval_request_event_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."approval_requests" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_call_event_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "approval_requests_tool_call_event_id_unique" UNIQUE("tool_call_event_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"name" text NOT NULL,
	"artifact_type" text NOT NULL,
	"storage_kind" text NOT NULL,
	"supersedes_artifact_id" uuid,
	"created_by_event_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "sync_artifacts_account_id_uq" UNIQUE("account_id","id")
);
--> statement-breakpoint
CREATE TABLE "sync"."change_envelopes" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync"."change_envelopes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"account_id" uuid NOT NULL,
	"change_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"workspace_project_id" uuid,
	"project_revision" bigint,
	"session_id" uuid,
	"session_revision" bigint,
	"kind" text NOT NULL,
	"payload_sha256" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_change_envelopes_account_change_uq" UNIQUE("account_id","change_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."event_artifacts" (
	"account_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	CONSTRAINT "event_artifacts_event_id_artifact_id_relationship_pk" PRIMARY KEY("event_id","artifact_id","relationship")
);
--> statement-breakpoint
CREATE TABLE "sync"."file_artifacts" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"mime_type" text NOT NULL,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"availability" text DEFAULT 'metadata_only' NOT NULL,
	"remote_locator" text
);
--> statement-breakpoint
CREATE TABLE "sync"."file_changes" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"workspace_project_id" uuid NOT NULL,
	"workspace_file_id" uuid NOT NULL,
	"tool_call_event_id" uuid,
	"operation" text NOT NULL,
	"before_version_id" uuid,
	"after_version_id" uuid,
	"text_diff" jsonb
);
--> statement-breakpoint
CREATE TABLE "sync"."link_artifacts" (
	"artifact_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"url" text NOT NULL,
	"provider" text,
	"external_id" text
);
--> statement-breakpoint
CREATE TABLE "sync"."message_parts" (
	"account_id" uuid NOT NULL,
	"message_event_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"part_type" text NOT NULL,
	"content" jsonb NOT NULL,
	CONSTRAINT "message_parts_message_event_id_position_pk" PRIMARY KEY("message_event_id","position"),
	CONSTRAINT "sync_message_parts_position_nonnegative_ck" CHECK ("sync"."message_parts"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync"."messages" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"message_kind" text NOT NULL,
	"status" text NOT NULL,
	"model" text,
	"provider_message_id" text,
	"finish_reason" text
);
--> statement-breakpoint
CREATE TABLE "sync"."reasoning_summaries" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"summary_kind" text NOT NULL,
	"summary_text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."session_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"session_revision" bigint NOT NULL,
	"event_type" text NOT NULL,
	"agent_run_id" uuid,
	"source_device_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sync_events_account_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "sync_events_session_revision_uq" UNIQUE("account_id","session_id","session_revision")
);
--> statement-breakpoint
CREATE TABLE "sync"."errors" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"retryable" boolean NOT NULL,
	"details_schema_id" text,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "sync"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"workspace_project_id" uuid,
	"title" text,
	"status" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_sessions_account_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "sync_sessions_revision_positive_ck" CHECK ("sync"."sessions"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "sync"."task_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"title" text NOT NULL,
	"supersedes_plan_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_plans_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."task_step_updates" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"task_step_id" uuid NOT NULL,
	"state" text NOT NULL,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "sync"."task_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	CONSTRAINT "sync_task_steps_plan_position_uq" UNIQUE("plan_id","position"),
	CONSTRAINT "sync_task_steps_position_nonnegative_ck" CHECK ("sync"."task_steps"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sync"."tool_calls" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"triggering_message_event_id" uuid,
	"capability" text NOT NULL,
	"operation" text NOT NULL,
	"input_schema_id" text NOT NULL,
	"input_schema_version" integer NOT NULL,
	"input" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."tool_progress_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_call_event_id" uuid NOT NULL,
	"progress_schema_id" text NOT NULL,
	"progress_schema_version" integer NOT NULL,
	"progress" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."tool_results" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"tool_call_event_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"output_schema_id" text,
	"output_schema_version" integer,
	"output" jsonb,
	CONSTRAINT "tool_results_tool_call_event_id_unique" UNIQUE("tool_call_event_id")
);
--> statement-breakpoint
CREATE TABLE "sync"."workspace_file_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"workspace_project_id" uuid NOT NULL,
	"workspace_file_id" uuid NOT NULL,
	"relative_path" text NOT NULL,
	"mime_type" text,
	"content_sha256" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"availability" text DEFAULT 'metadata_only' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."workspace_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"workspace_project_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync"."workspace_projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"origin_device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_workspace_projects_account_id_uq" UNIQUE("account_id","id"),
	CONSTRAINT "sync_workspace_projects_revision_positive_ck" CHECK ("sync"."workspace_projects"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "audit"."events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."events" ADD CONSTRAINT "events_actor_membership_id_organization_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "platform"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_changes" ADD CONSTRAINT "profile_changes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_changes" ADD CONSTRAINT "profile_changes_origin_device_id_devices_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_connections" ADD CONSTRAINT "profile_connections_origin_device_id_devices_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_connections" ADD CONSTRAINT "profile_connections_connector_fk" FOREIGN KEY ("account_id","profile_connector_id") REFERENCES "connectors"."profile_connectors"("account_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_connectors" ADD CONSTRAINT "profile_connectors_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_connectors" ADD CONSTRAINT "profile_connectors_connector_id_catalog_entries_id_fk" FOREIGN KEY ("connector_id") REFERENCES "connectors"."catalog_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connectors"."profile_connectors" ADD CONSTRAINT "profile_connectors_origin_device_id_devices_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."credential_references" ADD CONSTRAINT "credential_references_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deployment_revisions" ADD CONSTRAINT "deployment_revisions_deployment_fk" FOREIGN KEY ("organization_id","deployment_id") REFERENCES "platform"."deployments"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deployment_revisions" ADD CONSTRAINT "deployment_revisions_environment_fk" FOREIGN KEY ("organization_id","environment_id","project_id") REFERENCES "platform"."environments"("organization_id","id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deployment_revisions" ADD CONSTRAINT "deployment_revisions_release_fk" FOREIGN KEY ("organization_id","release_id","project_id") REFERENCES "platform"."releases"("organization_id","id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deployments" ADD CONSTRAINT "deployments_environment_fk" FOREIGN KEY ("organization_id","environment_id","project_id") REFERENCES "platform"."environments"("organization_id","id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deployments" ADD CONSTRAINT "deployments_release_fk" FOREIGN KEY ("organization_id","release_id","project_id") REFERENCES "platform"."releases"("organization_id","id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."deployments" ADD CONSTRAINT "deployments_updater_fk" FOREIGN KEY ("organization_id","updated_by_membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."devices" ADD CONSTRAINT "devices_owner_account_id_accounts_id_fk" FOREIGN KEY ("owner_account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."environments" ADD CONSTRAINT "environments_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "platform"."projects"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."group_assignments" ADD CONSTRAINT "group_assignments_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "platform"."organization_groups"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."group_assignments" ADD CONSTRAINT "group_assignments_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "platform"."environments"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."group_memberships" ADD CONSTRAINT "group_memberships_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "platform"."organization_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."group_memberships" ADD CONSTRAINT "group_memberships_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."installation_observations" ADD CONSTRAINT "installation_observations_device_fk" FOREIGN KEY ("organization_id","device_id") REFERENCES "platform"."organization_devices"("organization_id","device_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."installation_observations" ADD CONSTRAINT "installation_observations_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "platform"."environments"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."installation_observations" ADD CONSTRAINT "installation_observations_release_fk" FOREIGN KEY ("organization_id","release_id") REFERENCES "platform"."releases"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."membership_roles" ADD CONSTRAINT "membership_roles_role_id_role_definitions_id_fk" FOREIGN KEY ("role_id") REFERENCES "platform"."role_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."membership_roles" ADD CONSTRAINT "membership_roles_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."organization_devices" ADD CONSTRAINT "organization_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."organization_devices" ADD CONSTRAINT "organization_devices_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."organization_domains" ADD CONSTRAINT "organization_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."organization_groups" ADD CONSTRAINT "organization_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."organization_memberships" ADD CONSTRAINT "organization_memberships_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."accounts" ADD CONSTRAINT "accounts_auth_user_id_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policies" ADD CONSTRAINT "policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_device_assignments" ADD CONSTRAINT "policy_device_assignments_revision_fk" FOREIGN KEY ("organization_id","policy_revision_id") REFERENCES "platform"."policy_revisions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_device_assignments" ADD CONSTRAINT "policy_device_assignments_device_fk" FOREIGN KEY ("organization_id","device_id") REFERENCES "platform"."organization_devices"("organization_id","device_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_group_assignments" ADD CONSTRAINT "policy_group_assignments_revision_fk" FOREIGN KEY ("organization_id","policy_revision_id") REFERENCES "platform"."policy_revisions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_group_assignments" ADD CONSTRAINT "policy_group_assignments_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "platform"."organization_groups"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_membership_assignments" ADD CONSTRAINT "policy_membership_assignments_revision_fk" FOREIGN KEY ("organization_id","policy_revision_id") REFERENCES "platform"."policy_revisions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_membership_assignments" ADD CONSTRAINT "policy_membership_assignments_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_project_assignments" ADD CONSTRAINT "policy_project_assignments_revision_fk" FOREIGN KEY ("organization_id","policy_revision_id") REFERENCES "platform"."policy_revisions"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_project_assignments" ADD CONSTRAINT "policy_project_assignments_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "platform"."projects"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_revisions" ADD CONSTRAINT "policy_revisions_policy_fk" FOREIGN KEY ("organization_id","policy_id") REFERENCES "platform"."policies"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."policy_revisions" ADD CONSTRAINT "policy_revisions_creator_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "platform"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."release_artifacts" ADD CONSTRAINT "release_artifacts_release_tenant_fk" FOREIGN KEY ("organization_id","release_id") REFERENCES "platform"."releases"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."release_revocations" ADD CONSTRAINT "release_revocations_release_fk" FOREIGN KEY ("organization_id","release_id") REFERENCES "platform"."releases"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."release_revocations" ADD CONSTRAINT "release_revocations_membership_fk" FOREIGN KEY ("organization_id","revoked_by_membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."releases" ADD CONSTRAINT "releases_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "platform"."projects"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."releases" ADD CONSTRAINT "releases_creator_fk" FOREIGN KEY ("organization_id","created_by_membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."user_assignments" ADD CONSTRAINT "user_assignments_membership_fk" FOREIGN KEY ("organization_id","membership_id") REFERENCES "platform"."organization_memberships"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."user_assignments" ADD CONSTRAINT "user_assignments_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "platform"."environments"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."agent_run_presentations" ADD CONSTRAINT "agent_run_presentations_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."agent_run_presentations" ADD CONSTRAINT "agent_run_presentations_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "sync"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."agent_run_state_updates" ADD CONSTRAINT "agent_run_state_updates_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."agent_run_state_updates" ADD CONSTRAINT "agent_run_state_updates_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "sync"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."agent_runs" ADD CONSTRAINT "agent_runs_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."approval_decisions" ADD CONSTRAINT "approval_decisions_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."approval_decisions" ADD CONSTRAINT "approval_decisions_approval_request_event_id_approval_requests_event_id_fk" FOREIGN KEY ("approval_request_event_id") REFERENCES "sync"."approval_requests"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."approval_requests" ADD CONSTRAINT "approval_requests_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."approval_requests" ADD CONSTRAINT "approval_requests_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."artifacts" ADD CONSTRAINT "artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."artifacts" ADD CONSTRAINT "artifacts_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sync"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."artifacts" ADD CONSTRAINT "artifacts_created_by_event_id_session_events_id_fk" FOREIGN KEY ("created_by_event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."change_envelopes" ADD CONSTRAINT "change_envelopes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."change_envelopes" ADD CONSTRAINT "change_envelopes_origin_device_id_devices_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."event_artifacts" ADD CONSTRAINT "event_artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."event_artifacts" ADD CONSTRAINT "event_artifacts_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."event_artifacts" ADD CONSTRAINT "event_artifacts_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "sync"."artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_artifacts" ADD CONSTRAINT "file_artifacts_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "sync"."artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_artifacts" ADD CONSTRAINT "file_artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_changes" ADD CONSTRAINT "file_changes_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_changes" ADD CONSTRAINT "file_changes_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "sync"."agent_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_changes" ADD CONSTRAINT "file_changes_workspace_file_id_workspace_files_id_fk" FOREIGN KEY ("workspace_file_id") REFERENCES "sync"."workspace_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_changes" ADD CONSTRAINT "file_changes_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_changes" ADD CONSTRAINT "file_changes_before_version_id_workspace_file_versions_id_fk" FOREIGN KEY ("before_version_id") REFERENCES "sync"."workspace_file_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."file_changes" ADD CONSTRAINT "file_changes_after_version_id_workspace_file_versions_id_fk" FOREIGN KEY ("after_version_id") REFERENCES "sync"."workspace_file_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."link_artifacts" ADD CONSTRAINT "link_artifacts_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "sync"."artifacts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."link_artifacts" ADD CONSTRAINT "link_artifacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."message_parts" ADD CONSTRAINT "message_parts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."message_parts" ADD CONSTRAINT "message_parts_message_event_id_messages_event_id_fk" FOREIGN KEY ("message_event_id") REFERENCES "sync"."messages"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."messages" ADD CONSTRAINT "messages_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."reasoning_summaries" ADD CONSTRAINT "reasoning_summaries_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."session_events" ADD CONSTRAINT "session_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."session_events" ADD CONSTRAINT "session_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "sync"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."session_events" ADD CONSTRAINT "session_events_source_device_id_devices_id_fk" FOREIGN KEY ("source_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."errors" ADD CONSTRAINT "errors_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."sessions" ADD CONSTRAINT "sessions_origin_device_id_devices_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."sessions" ADD CONSTRAINT "sessions_workspace_project_id_workspace_projects_id_fk" FOREIGN KEY ("workspace_project_id") REFERENCES "sync"."workspace_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."task_plans" ADD CONSTRAINT "task_plans_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."task_step_updates" ADD CONSTRAINT "task_step_updates_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."task_step_updates" ADD CONSTRAINT "task_step_updates_task_step_id_task_steps_id_fk" FOREIGN KEY ("task_step_id") REFERENCES "sync"."task_steps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."task_steps" ADD CONSTRAINT "task_steps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."task_steps" ADD CONSTRAINT "task_steps_plan_id_task_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "sync"."task_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."tool_calls" ADD CONSTRAINT "tool_calls_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."tool_progress_events" ADD CONSTRAINT "tool_progress_events_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."tool_progress_events" ADD CONSTRAINT "tool_progress_events_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."tool_results" ADD CONSTRAINT "tool_results_event_id_session_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "sync"."session_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."tool_results" ADD CONSTRAINT "tool_results_tool_call_event_id_tool_calls_event_id_fk" FOREIGN KEY ("tool_call_event_id") REFERENCES "sync"."tool_calls"("event_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."workspace_file_versions" ADD CONSTRAINT "workspace_file_versions_workspace_file_id_workspace_files_id_fk" FOREIGN KEY ("workspace_file_id") REFERENCES "sync"."workspace_files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."workspace_files" ADD CONSTRAINT "workspace_files_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."workspace_files" ADD CONSTRAINT "workspace_files_workspace_project_id_workspace_projects_id_fk" FOREIGN KEY ("workspace_project_id") REFERENCES "sync"."workspace_projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."workspace_projects" ADD CONSTRAINT "workspace_projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "platform"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync"."workspace_projects" ADD CONSTRAINT "workspace_projects_origin_device_id_devices_id_fk" FOREIGN KEY ("origin_device_id") REFERENCES "platform"."devices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_idx" ON "audit"."events" USING btree ("organization_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_subject_idx" ON "audit"."events" USING btree ("organization_id","subject_kind","subject_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth"."account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth"."session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth"."verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "connector_catalog_featured_category_title_idx" ON "connectors"."catalog_entries" USING btree ("featured","category","title","id");--> statement-breakpoint
CREATE INDEX "connector_catalog_domain_idx" ON "connectors"."catalog_entries" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "connector_catalog_search_idx" ON "connectors"."catalog_entries" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '')));--> statement-breakpoint
CREATE INDEX "connector_catalog_runs_source_started_idx" ON "connectors"."catalog_ingestion_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "profile_changes_account_cursor_idx" ON "connectors"."profile_changes" USING btree ("account_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_connectors_account_connector_active_uq" ON "connectors"."profile_connectors" USING btree ("account_id","connector_id") WHERE "connectors"."profile_connectors"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "devices_owner_account_idx" ON "platform"."devices" USING btree ("owner_account_id");--> statement-breakpoint
CREATE INDEX "installation_observations_device_environment_idx" ON "platform"."installation_observations" USING btree ("organization_id","device_id","environment_id","observed_at");--> statement-breakpoint
CREATE INDEX "organization_domains_organization_idx" ON "platform"."organization_domains" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_account_idx" ON "platform"."organization_memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "sync_run_state_run_occurred_idx" ON "sync"."agent_run_state_updates" USING btree ("agent_run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sync_agent_runs_account_session_started_idx" ON "sync"."agent_runs" USING btree ("account_id","session_id","started_at");--> statement-breakpoint
CREATE INDEX "sync_change_envelopes_account_cursor_idx" ON "sync"."change_envelopes" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "sync_file_changes_run_idx" ON "sync"."file_changes" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "sync_file_changes_file_idx" ON "sync"."file_changes" USING btree ("workspace_file_id");--> statement-breakpoint
CREATE INDEX "sync_events_account_run_occurred_idx" ON "sync"."session_events" USING btree ("account_id","agent_run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sync_sessions_account_project_updated_idx" ON "sync"."sessions" USING btree ("account_id","workspace_project_id","updated_at");--> statement-breakpoint
CREATE INDEX "sync_task_plans_session_created_idx" ON "sync"."task_plans" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "sync_tool_progress_call_idx" ON "sync"."tool_progress_events" USING btree ("tool_call_event_id");--> statement-breakpoint
CREATE INDEX "sync_workspace_file_versions_file_captured_idx" ON "sync"."workspace_file_versions" USING btree ("workspace_file_id","captured_at");--> statement-breakpoint
CREATE INDEX "sync_workspace_files_project_idx" ON "sync"."workspace_files" USING btree ("account_id","workspace_project_id");--> statement-breakpoint
CREATE INDEX "sync_workspace_projects_account_updated_idx" ON "sync"."workspace_projects" USING btree ("account_id","updated_at");
