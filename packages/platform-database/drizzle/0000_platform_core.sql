CREATE SCHEMA "radius_platform";
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_deployment_artifacts" (
	"agent_deployment_artifact_id" uuid PRIMARY KEY NOT NULL,
	"agent_deployment_id" uuid NOT NULL,
	"artifact_kind" text NOT NULL,
	"provider_reference" text NOT NULL,
	"digest" text NOT NULL,
	"media_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"operating_system" text,
	"architecture" text,
	"variant" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_deployment_artifacts_kind_check" CHECK ("radius_platform"."agent_deployment_artifacts"."artifact_kind" IN ('oci_manifest', 'source_bundle', 'sbom', 'provenance', 'signature', 'notices')),
	CONSTRAINT "agent_deployment_artifacts_reference_check" CHECK (char_length("radius_platform"."agent_deployment_artifacts"."provider_reference") BETWEEN 1 AND 2048),
	CONSTRAINT "agent_deployment_artifacts_digest_check" CHECK ("radius_platform"."agent_deployment_artifacts"."digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "agent_deployment_artifacts_media_type_check" CHECK (char_length("radius_platform"."agent_deployment_artifacts"."media_type") BETWEEN 1 AND 255),
	CONSTRAINT "agent_deployment_artifacts_size_check" CHECK ("radius_platform"."agent_deployment_artifacts"."byte_size" >= 0),
	CONSTRAINT "agent_deployment_artifacts_platform_check" CHECK (("radius_platform"."agent_deployment_artifacts"."operating_system" IS NULL AND "radius_platform"."agent_deployment_artifacts"."architecture" IS NULL AND "radius_platform"."agent_deployment_artifacts"."variant" IS NULL) OR ("radius_platform"."agent_deployment_artifacts"."operating_system" IS NOT NULL AND "radius_platform"."agent_deployment_artifacts"."architecture" IS NOT NULL AND char_length("radius_platform"."agent_deployment_artifacts"."operating_system") BETWEEN 1 AND 64 AND char_length("radius_platform"."agent_deployment_artifacts"."architecture") BETWEEN 1 AND 64 AND ("radius_platform"."agent_deployment_artifacts"."variant" IS NULL OR char_length("radius_platform"."agent_deployment_artifacts"."variant") BETWEEN 1 AND 64)))
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_deployment_uploads" (
	"upload_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"requested_environment_id" uuid NOT NULL,
	"created_by_membership_id" uuid,
	"created_by_developer_token_id" uuid,
	"system_actor_code" text,
	"build_digest" text NOT NULL,
	"bundle_sha256" text NOT NULL,
	"minimum_desktop_version" text NOT NULL,
	"runtime_protocol_version" smallint NOT NULL,
	"image_reference" text NOT NULL,
	"secret_reference" text,
	"upload_state" text DEFAULT 'prepared' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_deployment_uploads_actor_check" CHECK (num_nonnulls("radius_platform"."agent_deployment_uploads"."created_by_membership_id", "radius_platform"."agent_deployment_uploads"."created_by_developer_token_id", "radius_platform"."agent_deployment_uploads"."system_actor_code") = 1),
	CONSTRAINT "agent_deployment_uploads_build_digest_check" CHECK ("radius_platform"."agent_deployment_uploads"."build_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_deployment_uploads_bundle_digest_check" CHECK ("radius_platform"."agent_deployment_uploads"."bundle_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_deployment_uploads_system_actor_check" CHECK ("radius_platform"."agent_deployment_uploads"."system_actor_code" IS NULL OR "radius_platform"."agent_deployment_uploads"."system_actor_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "agent_deployment_uploads_desktop_version_check" CHECK ("radius_platform"."agent_deployment_uploads"."minimum_desktop_version" ~ '^[0-9]+.[0-9]+.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
	CONSTRAINT "agent_deployment_uploads_runtime_protocol_check" CHECK ("radius_platform"."agent_deployment_uploads"."runtime_protocol_version" > 0),
	CONSTRAINT "agent_deployment_uploads_image_reference_check" CHECK (char_length("radius_platform"."agent_deployment_uploads"."image_reference") BETWEEN 1 AND 1024),
	CONSTRAINT "agent_deployment_uploads_secret_reference_check" CHECK ("radius_platform"."agent_deployment_uploads"."secret_reference" IS NULL OR char_length("radius_platform"."agent_deployment_uploads"."secret_reference") BETWEEN 1 AND 1024),
	CONSTRAINT "agent_deployment_uploads_state_check" CHECK ("radius_platform"."agent_deployment_uploads"."upload_state" IN ('prepared', 'finalized', 'expired', 'failed')),
	CONSTRAINT "agent_deployment_uploads_finalized_check" CHECK (("radius_platform"."agent_deployment_uploads"."upload_state" = 'finalized') = ("radius_platform"."agent_deployment_uploads"."finalized_at" IS NOT NULL)),
	CONSTRAINT "agent_deployment_uploads_expiry_check" CHECK ("radius_platform"."agent_deployment_uploads"."expires_at" > "radius_platform"."agent_deployment_uploads"."created_at"),
	CONSTRAINT "agent_deployment_uploads_timestamps_check" CHECK ("radius_platform"."agent_deployment_uploads"."updated_at" >= "radius_platform"."agent_deployment_uploads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_deployments" (
	"agent_deployment_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"upload_id" uuid NOT NULL,
	"version" text NOT NULL,
	"agent_config_version" smallint NOT NULL,
	"agent_manifest_version" smallint NOT NULL,
	"minimum_desktop_version" text NOT NULL,
	"runtime_protocol_version" smallint NOT NULL,
	"image_digest" text NOT NULL,
	"source_manifest_digest" text NOT NULL,
	"bundle_sha256" text NOT NULL,
	"verification_state" text DEFAULT 'pending' NOT NULL,
	"verification_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_deployments_identity_key" UNIQUE("agent_deployment_id","agent_id"),
	CONSTRAINT "agent_deployments_image_digest_check" CHECK ("radius_platform"."agent_deployments"."image_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "agent_deployments_source_manifest_digest_check" CHECK ("radius_platform"."agent_deployments"."source_manifest_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "agent_deployments_version_check" CHECK (char_length(btrim("radius_platform"."agent_deployments"."version")) BETWEEN 1 AND 120),
	CONSTRAINT "agent_deployments_config_version_check" CHECK ("radius_platform"."agent_deployments"."agent_config_version" > 0),
	CONSTRAINT "agent_deployments_manifest_version_check" CHECK ("radius_platform"."agent_deployments"."agent_manifest_version" > 0),
	CONSTRAINT "agent_deployments_desktop_version_check" CHECK ("radius_platform"."agent_deployments"."minimum_desktop_version" ~ '^[0-9]+.[0-9]+.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
	CONSTRAINT "agent_deployments_runtime_protocol_check" CHECK ("radius_platform"."agent_deployments"."runtime_protocol_version" > 0),
	CONSTRAINT "agent_deployments_bundle_digest_check" CHECK ("radius_platform"."agent_deployments"."bundle_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "agent_deployments_verification_state_check" CHECK ("radius_platform"."agent_deployments"."verification_state" IN ('pending', 'verified', 'quarantined', 'revoked')),
	CONSTRAINT "agent_deployments_verification_time_check" CHECK (("radius_platform"."agent_deployments"."verification_state" = 'pending' AND "radius_platform"."agent_deployments"."verification_completed_at" IS NULL) OR ("radius_platform"."agent_deployments"."verification_state" IN ('verified', 'quarantined', 'revoked') AND "radius_platform"."agent_deployments"."verification_completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_environment_revisions" (
	"agent_environment_revision_id" uuid PRIMARY KEY NOT NULL,
	"environment_id" uuid NOT NULL,
	"revision" bigint NOT NULL,
	"action_code" text NOT NULL,
	"agent_deployment_id" uuid,
	"actor_membership_id" uuid,
	"actor_developer_token_id" uuid,
	"system_actor_code" text,
	"reason" text,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_environment_revisions_revision_check" CHECK ("radius_platform"."agent_environment_revisions"."revision" > 0),
	CONSTRAINT "agent_environment_revisions_action_check" CHECK ("radius_platform"."agent_environment_revisions"."action_code" IN ('deploy', 'promote', 'rollback', 'revoke')),
	CONSTRAINT "agent_environment_revisions_deployment_action_check" CHECK (("radius_platform"."agent_environment_revisions"."action_code" = 'revoke' AND "radius_platform"."agent_environment_revisions"."agent_deployment_id" IS NULL) OR ("radius_platform"."agent_environment_revisions"."action_code" <> 'revoke' AND "radius_platform"."agent_environment_revisions"."agent_deployment_id" IS NOT NULL)),
	CONSTRAINT "agent_environment_revisions_actor_check" CHECK (num_nonnulls("radius_platform"."agent_environment_revisions"."actor_membership_id", "radius_platform"."agent_environment_revisions"."actor_developer_token_id", "radius_platform"."agent_environment_revisions"."system_actor_code") = 1),
	CONSTRAINT "agent_environment_revisions_system_actor_check" CHECK ("radius_platform"."agent_environment_revisions"."system_actor_code" IS NULL OR "radius_platform"."agent_environment_revisions"."system_actor_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "agent_environment_revisions_reason_check" CHECK ("radius_platform"."agent_environment_revisions"."reason" IS NULL OR char_length("radius_platform"."agent_environment_revisions"."reason") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_environments" (
	"environment_id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_environments_slug_check" CHECK ("radius_platform"."agent_environments"."slug" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "agent_environments_display_name_check" CHECK (char_length(btrim("radius_platform"."agent_environments"."display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "agent_environments_lifecycle_state_check" CHECK ("radius_platform"."agent_environments"."lifecycle_state" IN ('active', 'archived')),
	CONSTRAINT "agent_environments_timestamps_check" CHECK ("radius_platform"."agent_environments"."updated_at" >= "radius_platform"."agent_environments"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agents" (
	"agent_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"agent_ref" text NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"default_environment_id" uuid,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agents_identity_key" UNIQUE("agent_id","organization_id"),
	CONSTRAINT "agents_ref_check" CHECK ("radius_platform"."agents"."agent_ref" ~ '^agent_[A-Za-z0-9_-]{6,64}$'),
	CONSTRAINT "agents_slug_check" CHECK ("radius_platform"."agents"."slug" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "agents_display_name_check" CHECK (char_length(btrim("radius_platform"."agents"."display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "agents_description_check" CHECK ("radius_platform"."agents"."description" IS NULL OR char_length("radius_platform"."agents"."description") <= 4000),
	CONSTRAINT "agents_lifecycle_state_check" CHECK ("radius_platform"."agents"."lifecycle_state" IN ('active', 'archived')),
	CONSTRAINT "agents_timestamps_check" CHECK ("radius_platform"."agents"."updated_at" >= "radius_platform"."agents"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."developer_token_agents" (
	"developer_token_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "developer_token_agents_developer_token_id_agent_id_pk" PRIMARY KEY("developer_token_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."account_identities" (
	"account_identity_id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"issuer" text NOT NULL,
	"provider_subject" text NOT NULL,
	"email_normalized" text,
	"email_verified_at" timestamp with time zone,
	"last_authenticated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "account_identities_issuer_check" CHECK (char_length(btrim("radius_platform"."account_identities"."issuer")) BETWEEN 1 AND 512),
	CONSTRAINT "account_identities_subject_check" CHECK (char_length("radius_platform"."account_identities"."provider_subject") BETWEEN 1 AND 512),
	CONSTRAINT "account_identities_email_check" CHECK ("radius_platform"."account_identities"."email_normalized" IS NULL OR (char_length("radius_platform"."account_identities"."email_normalized") BETWEEN 3 AND 320 AND "radius_platform"."account_identities"."email_normalized" = lower("radius_platform"."account_identities"."email_normalized"))),
	CONSTRAINT "account_identities_auth_time_check" CHECK ("radius_platform"."account_identities"."last_authenticated_at" IS NULL OR "radius_platform"."account_identities"."last_authenticated_at" >= "radius_platform"."account_identities"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."accounts" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "accounts_display_name_check" CHECK ("radius_platform"."accounts"."display_name" IS NULL OR char_length(btrim("radius_platform"."accounts"."display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "accounts_lifecycle_state_check" CHECK ("radius_platform"."accounts"."lifecycle_state" IN ('active', 'disabled')),
	CONSTRAINT "accounts_timestamps_check" CHECK ("radius_platform"."accounts"."updated_at" >= "radius_platform"."accounts"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."platform_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"account_identity_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"token_prefix" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "platform_sessions_token_hash_check" CHECK (octet_length("radius_platform"."platform_sessions"."token_hash") = 32),
	CONSTRAINT "platform_sessions_prefix_check" CHECK (char_length("radius_platform"."platform_sessions"."token_prefix") BETWEEN 4 AND 32),
	CONSTRAINT "platform_sessions_expiry_check" CHECK ("radius_platform"."platform_sessions"."expires_at" > "radius_platform"."platform_sessions"."issued_at"),
	CONSTRAINT "platform_sessions_last_used_check" CHECK ("radius_platform"."platform_sessions"."last_used_at" IS NULL OR "radius_platform"."platform_sessions"."last_used_at" >= "radius_platform"."platform_sessions"."issued_at"),
	CONSTRAINT "platform_sessions_revoked_check" CHECK ("radius_platform"."platform_sessions"."revoked_at" IS NULL OR "radius_platform"."platform_sessions"."revoked_at" >= "radius_platform"."platform_sessions"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_installation_observations" (
	"agent_installation_observation_id" uuid PRIMARY KEY NOT NULL,
	"agent_installation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_deployment_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"observation_state" text NOT NULL,
	"error_code" text,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_installation_observations_schema_check" CHECK ("radius_platform"."agent_installation_observations"."schema_version" > 0),
	CONSTRAINT "agent_installation_observations_state_check" CHECK ("radius_platform"."agent_installation_observations"."observation_state" IN ('installing', 'ready', 'failed', 'retained', 'removed', 'blocked_incompatible')),
	CONSTRAINT "agent_installation_observations_error_check" CHECK (("radius_platform"."agent_installation_observations"."observation_state" IN ('failed', 'blocked_incompatible') AND "radius_platform"."agent_installation_observations"."error_code" ~ '^[A-Z][A-Z0-9_]{1,127}$') OR ("radius_platform"."agent_installation_observations"."observation_state" NOT IN ('failed', 'blocked_incompatible') AND "radius_platform"."agent_installation_observations"."error_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."agent_installations" (
	"agent_installation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"client_installation_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"installed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "agent_installations_identity_key" UNIQUE("agent_installation_id","agent_id"),
	CONSTRAINT "agent_installations_organization_key" UNIQUE("agent_installation_id","organization_id"),
	CONSTRAINT "agent_installations_lifecycle_check" CHECK ("radius_platform"."agent_installations"."lifecycle_state" IN ('active', 'removed')),
	CONSTRAINT "agent_installations_timestamps_check" CHECK ("radius_platform"."agent_installations"."updated_at" >= "radius_platform"."agent_installations"."installed_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."client_installation_observations" (
	"client_installation_observation_id" uuid PRIMARY KEY NOT NULL,
	"client_installation_id" uuid NOT NULL,
	"client_event_id" uuid NOT NULL,
	"schema_version" smallint DEFAULT 1 NOT NULL,
	"desktop_version" text NOT NULL,
	"runtime_version" text NOT NULL,
	"runtime_protocol_version" smallint NOT NULL,
	"observation_state" text NOT NULL,
	"error_code" text,
	"observed_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "client_installation_observations_schema_check" CHECK ("radius_platform"."client_installation_observations"."schema_version" > 0),
	CONSTRAINT "client_installation_observations_desktop_version_check" CHECK (char_length(btrim("radius_platform"."client_installation_observations"."desktop_version")) BETWEEN 1 AND 120),
	CONSTRAINT "client_installation_observations_runtime_version_check" CHECK (char_length(btrim("radius_platform"."client_installation_observations"."runtime_version")) BETWEEN 1 AND 120),
	CONSTRAINT "client_installation_observations_protocol_check" CHECK ("radius_platform"."client_installation_observations"."runtime_protocol_version" > 0),
	CONSTRAINT "client_installation_observations_state_check" CHECK ("radius_platform"."client_installation_observations"."observation_state" IN ('ready', 'degraded', 'update_required', 'error')),
	CONSTRAINT "client_installation_observations_error_check" CHECK (("radius_platform"."client_installation_observations"."observation_state" = 'error' AND "radius_platform"."client_installation_observations"."error_code" ~ '^[A-Z][A-Z0-9_]{1,127}$') OR ("radius_platform"."client_installation_observations"."observation_state" <> 'error' AND "radius_platform"."client_installation_observations"."error_code" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."client_installations" (
	"client_installation_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"physical_device_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"client_instance_id" uuid NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"installed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "client_installations_identity_key" UNIQUE("client_installation_id","organization_id"),
	CONSTRAINT "client_installations_lifecycle_check" CHECK ("radius_platform"."client_installations"."lifecycle_state" IN ('active', 'suspended', 'removed')),
	CONSTRAINT "client_installations_timestamps_check" CHECK ("radius_platform"."client_installations"."created_at" >= "radius_platform"."client_installations"."installed_at" AND "radius_platform"."client_installations"."updated_at" >= "radius_platform"."client_installations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."physical_devices" (
	"physical_device_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"assigned_membership_id" uuid,
	"device_fingerprint" text NOT NULL,
	"display_name" text NOT NULL,
	"asset_tag" text,
	"platform" text NOT NULL,
	"architecture" text NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "physical_devices_identity_key" UNIQUE("physical_device_id","organization_id"),
	CONSTRAINT "physical_devices_fingerprint_check" CHECK ("radius_platform"."physical_devices"."device_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "physical_devices_display_name_check" CHECK (char_length(btrim("radius_platform"."physical_devices"."display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "physical_devices_asset_tag_check" CHECK ("radius_platform"."physical_devices"."asset_tag" IS NULL OR char_length(btrim("radius_platform"."physical_devices"."asset_tag")) BETWEEN 1 AND 120),
	CONSTRAINT "physical_devices_platform_check" CHECK (char_length(btrim("radius_platform"."physical_devices"."platform")) BETWEEN 1 AND 64),
	CONSTRAINT "physical_devices_architecture_check" CHECK (char_length(btrim("radius_platform"."physical_devices"."architecture")) BETWEEN 1 AND 64),
	CONSTRAINT "physical_devices_lifecycle_check" CHECK ("radius_platform"."physical_devices"."lifecycle_state" IN ('active', 'suspended', 'retired', 'lost')),
	CONSTRAINT "physical_devices_timestamps_check" CHECK ("radius_platform"."physical_devices"."updated_at" >= "radius_platform"."physical_devices"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."audit_events" (
	"audit_event_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_key" text,
	"actor_membership_id" uuid,
	"actor_developer_token_id" uuid,
	"system_actor_code" text,
	"action_code" text NOT NULL,
	"outcome_code" text NOT NULL,
	"agent_id" uuid,
	"agent_deployment_id" uuid,
	"environment_id" uuid,
	"agent_environment_revision_id" uuid,
	"physical_device_id" uuid,
	"client_installation_id" uuid,
	"agent_installation_id" uuid,
	"request_id" uuid,
	"safe_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "audit_events_event_key_check" CHECK ("radius_platform"."audit_events"."event_key" IS NULL OR char_length("radius_platform"."audit_events"."event_key") BETWEEN 1 AND 240),
	CONSTRAINT "audit_events_actor_check" CHECK (num_nonnulls("radius_platform"."audit_events"."actor_membership_id", "radius_platform"."audit_events"."actor_developer_token_id", "radius_platform"."audit_events"."system_actor_code") = 1),
	CONSTRAINT "audit_events_system_actor_check" CHECK ("radius_platform"."audit_events"."system_actor_code" IS NULL OR "radius_platform"."audit_events"."system_actor_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "audit_events_action_check" CHECK ("radius_platform"."audit_events"."action_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "audit_events_outcome_check" CHECK ("radius_platform"."audit_events"."outcome_code" IN ('success', 'denied', 'failure')),
	CONSTRAINT "audit_events_metadata_check" CHECK (jsonb_typeof("radius_platform"."audit_events"."safe_metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."idempotency_records" (
	"idempotency_record_id" uuid PRIMARY KEY NOT NULL,
	"authority_fingerprint" "bytea" NOT NULL,
	"operation_code" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_digest" text NOT NULL,
	"record_state" text DEFAULT 'pending' NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"resource_reference" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_authority_check" CHECK (octet_length("radius_platform"."idempotency_records"."authority_fingerprint") = 32),
	CONSTRAINT "idempotency_records_operation_check" CHECK ("radius_platform"."idempotency_records"."operation_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "idempotency_records_key_check" CHECK (char_length("radius_platform"."idempotency_records"."idempotency_key") BETWEEN 8 AND 240),
	CONSTRAINT "idempotency_records_request_digest_check" CHECK ("radius_platform"."idempotency_records"."request_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_records_state_check" CHECK ("radius_platform"."idempotency_records"."record_state" IN ('pending', 'completed')),
	CONSTRAINT "idempotency_records_response_check" CHECK (("radius_platform"."idempotency_records"."record_state" = 'pending' AND "radius_platform"."idempotency_records"."response_status" IS NULL AND "radius_platform"."idempotency_records"."response_body" IS NULL) OR ("radius_platform"."idempotency_records"."record_state" = 'completed' AND "radius_platform"."idempotency_records"."response_status" BETWEEN 100 AND 599 AND "radius_platform"."idempotency_records"."response_body" IS NOT NULL)),
	CONSTRAINT "idempotency_records_response_body_check" CHECK ("radius_platform"."idempotency_records"."response_body" IS NULL OR jsonb_typeof("radius_platform"."idempotency_records"."response_body") = 'object'),
	CONSTRAINT "idempotency_records_resource_check" CHECK ("radius_platform"."idempotency_records"."resource_reference" IS NULL OR char_length("radius_platform"."idempotency_records"."resource_reference") <= 1024),
	CONSTRAINT "idempotency_records_expiry_check" CHECK ("radius_platform"."idempotency_records"."expires_at" > "radius_platform"."idempotency_records"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."job_outbox_messages" (
	"outbox_message_id" uuid PRIMARY KEY NOT NULL,
	"aggregate_code" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"job_name" text NOT NULL,
	"job_version" smallint NOT NULL,
	"payload" jsonb NOT NULL,
	"job_idempotency_key" text NOT NULL,
	"message_state" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"published_at" timestamp with time zone,
	"terminal_error_code" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "job_outbox_aggregate_check" CHECK ("radius_platform"."job_outbox_messages"."aggregate_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "job_outbox_name_check" CHECK ("radius_platform"."job_outbox_messages"."job_name" ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
	CONSTRAINT "job_outbox_version_check" CHECK ("radius_platform"."job_outbox_messages"."job_version" > 0),
	CONSTRAINT "job_outbox_payload_check" CHECK (jsonb_typeof("radius_platform"."job_outbox_messages"."payload") = 'object'),
	CONSTRAINT "job_outbox_idempotency_key_check" CHECK (char_length("radius_platform"."job_outbox_messages"."job_idempotency_key") BETWEEN 8 AND 240),
	CONSTRAINT "job_outbox_state_check" CHECK ("radius_platform"."job_outbox_messages"."message_state" IN ('pending', 'published', 'failed')),
	CONSTRAINT "job_outbox_attempt_count_check" CHECK ("radius_platform"."job_outbox_messages"."attempt_count" >= 0),
	CONSTRAINT "job_outbox_published_check" CHECK (("radius_platform"."job_outbox_messages"."message_state" = 'published' AND "radius_platform"."job_outbox_messages"."published_at" IS NOT NULL) OR ("radius_platform"."job_outbox_messages"."message_state" <> 'published' AND "radius_platform"."job_outbox_messages"."published_at" IS NULL)),
	CONSTRAINT "job_outbox_terminal_error_check" CHECK (("radius_platform"."job_outbox_messages"."message_state" = 'failed' AND "radius_platform"."job_outbox_messages"."terminal_error_code" IS NOT NULL) OR ("radius_platform"."job_outbox_messages"."message_state" <> 'failed' AND "radius_platform"."job_outbox_messages"."terminal_error_code" IS NULL)),
	CONSTRAINT "job_outbox_terminal_error_code_check" CHECK ("radius_platform"."job_outbox_messages"."terminal_error_code" IS NULL OR "radius_platform"."job_outbox_messages"."terminal_error_code" ~ '^[A-Z][A-Z0-9_]{1,127}$'),
	CONSTRAINT "job_outbox_timestamps_check" CHECK ("radius_platform"."job_outbox_messages"."updated_at" >= "radius_platform"."job_outbox_messages"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."developer_token_scopes" (
	"developer_token_id" uuid NOT NULL,
	"scope_code" text NOT NULL,
	CONSTRAINT "developer_token_scopes_developer_token_id_scope_code_pk" PRIMARY KEY("developer_token_id","scope_code"),
	CONSTRAINT "developer_token_scopes_code_check" CHECK ("radius_platform"."developer_token_scopes"."scope_code" ~ '^[a-z][a-z0-9_.:-]{1,127}$')
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."developer_tokens" (
	"developer_token_id" uuid PRIMARY KEY NOT NULL,
	"membership_id" uuid NOT NULL,
	"label" text NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "developer_tokens_label_check" CHECK (char_length(btrim("radius_platform"."developer_tokens"."label")) BETWEEN 1 AND 120),
	CONSTRAINT "developer_tokens_hash_check" CHECK (octet_length("radius_platform"."developer_tokens"."token_hash") = 32),
	CONSTRAINT "developer_tokens_prefix_check" CHECK (char_length("radius_platform"."developer_tokens"."token_prefix") BETWEEN 4 AND 32),
	CONSTRAINT "developer_tokens_expiry_check" CHECK ("radius_platform"."developer_tokens"."expires_at" IS NULL OR "radius_platform"."developer_tokens"."expires_at" > "radius_platform"."developer_tokens"."created_at"),
	CONSTRAINT "developer_tokens_last_used_check" CHECK ("radius_platform"."developer_tokens"."last_used_at" IS NULL OR "radius_platform"."developer_tokens"."last_used_at" >= "radius_platform"."developer_tokens"."created_at"),
	CONSTRAINT "developer_tokens_revoked_check" CHECK ("radius_platform"."developer_tokens"."revoked_at" IS NULL OR "radius_platform"."developer_tokens"."revoked_at" >= "radius_platform"."developer_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."organization_memberships" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "organization_memberships_identity_key" UNIQUE("membership_id","organization_id"),
	CONSTRAINT "organization_memberships_role_check" CHECK ("radius_platform"."organization_memberships"."role_code" IN ('owner', 'admin', 'developer', 'viewer')),
	CONSTRAINT "organization_memberships_lifecycle_state_check" CHECK ("radius_platform"."organization_memberships"."lifecycle_state" IN ('active', 'suspended', 'removed')),
	CONSTRAINT "organization_memberships_timestamps_check" CHECK ("radius_platform"."organization_memberships"."updated_at" >= "radius_platform"."organization_memberships"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "radius_platform"."organizations" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_state" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "organizations_slug_check" CHECK ("radius_platform"."organizations"."slug" ~ '^[a-z][a-z0-9-]{0,62}$'),
	CONSTRAINT "organizations_display_name_check" CHECK (char_length(btrim("radius_platform"."organizations"."display_name")) BETWEEN 1 AND 120),
	CONSTRAINT "organizations_lifecycle_state_check" CHECK ("radius_platform"."organizations"."lifecycle_state" IN ('active', 'suspended', 'archived')),
	CONSTRAINT "organizations_timestamps_check" CHECK ("radius_platform"."organizations"."updated_at" >= "radius_platform"."organizations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployment_artifacts" ADD CONSTRAINT "agent_deployment_artifacts_agent_deployment_id_agent_deployments_agent_deployment_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "radius_platform"."agent_deployments"("agent_deployment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployment_uploads" ADD CONSTRAINT "agent_deployment_uploads_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "radius_platform"."agents"("agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployment_uploads" ADD CONSTRAINT "agent_deployment_uploads_requested_environment_id_agent_environments_environment_id_fk" FOREIGN KEY ("requested_environment_id") REFERENCES "radius_platform"."agent_environments"("environment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployment_uploads" ADD CONSTRAINT "agent_deployment_uploads_created_by_membership_id_organization_memberships_membership_id_fk" FOREIGN KEY ("created_by_membership_id") REFERENCES "radius_platform"."organization_memberships"("membership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployment_uploads" ADD CONSTRAINT "agent_deployment_uploads_created_by_developer_token_id_developer_tokens_developer_token_id_fk" FOREIGN KEY ("created_by_developer_token_id") REFERENCES "radius_platform"."developer_tokens"("developer_token_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployments" ADD CONSTRAINT "agent_deployments_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "radius_platform"."agents"("agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_deployments" ADD CONSTRAINT "agent_deployments_upload_id_agent_deployment_uploads_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "radius_platform"."agent_deployment_uploads"("upload_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_environment_revisions" ADD CONSTRAINT "agent_environment_revisions_environment_id_agent_environments_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "radius_platform"."agent_environments"("environment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_environment_revisions" ADD CONSTRAINT "agent_environment_revisions_agent_deployment_id_agent_deployments_agent_deployment_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "radius_platform"."agent_deployments"("agent_deployment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_environment_revisions" ADD CONSTRAINT "agent_environment_revisions_actor_membership_id_organization_memberships_membership_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "radius_platform"."organization_memberships"("membership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_environment_revisions" ADD CONSTRAINT "agent_environment_revisions_actor_developer_token_id_developer_tokens_developer_token_id_fk" FOREIGN KEY ("actor_developer_token_id") REFERENCES "radius_platform"."developer_tokens"("developer_token_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_environments" ADD CONSTRAINT "agent_environments_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "radius_platform"."agents"("agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agents" ADD CONSTRAINT "agents_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agents" ADD CONSTRAINT "agents_default_environment_id_agent_environments_environment_id_fk" FOREIGN KEY ("default_environment_id") REFERENCES "radius_platform"."agent_environments"("environment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."developer_token_agents" ADD CONSTRAINT "developer_token_agents_developer_token_id_developer_tokens_developer_token_id_fk" FOREIGN KEY ("developer_token_id") REFERENCES "radius_platform"."developer_tokens"("developer_token_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."developer_token_agents" ADD CONSTRAINT "developer_token_agents_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "radius_platform"."agents"("agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."account_identities" ADD CONSTRAINT "account_identities_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "radius_platform"."accounts"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."platform_sessions" ADD CONSTRAINT "platform_sessions_account_identity_id_account_identities_account_identity_id_fk" FOREIGN KEY ("account_identity_id") REFERENCES "radius_platform"."account_identities"("account_identity_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_installation_observations" ADD CONSTRAINT "agent_installation_observations_installation_fk" FOREIGN KEY ("agent_installation_id","agent_id") REFERENCES "radius_platform"."agent_installations"("agent_installation_id","agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_installation_observations" ADD CONSTRAINT "agent_installation_observations_deployment_fk" FOREIGN KEY ("agent_deployment_id","agent_id") REFERENCES "radius_platform"."agent_deployments"("agent_deployment_id","agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_installations" ADD CONSTRAINT "agent_installations_client_fk" FOREIGN KEY ("client_installation_id","organization_id") REFERENCES "radius_platform"."client_installations"("client_installation_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."agent_installations" ADD CONSTRAINT "agent_installations_agent_fk" FOREIGN KEY ("agent_id","organization_id") REFERENCES "radius_platform"."agents"("agent_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."client_installation_observations" ADD CONSTRAINT "client_installation_observations_client_installation_id_client_installations_client_installation_id_fk" FOREIGN KEY ("client_installation_id") REFERENCES "radius_platform"."client_installations"("client_installation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."client_installations" ADD CONSTRAINT "client_installations_device_fk" FOREIGN KEY ("physical_device_id","organization_id") REFERENCES "radius_platform"."physical_devices"("physical_device_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."client_installations" ADD CONSTRAINT "client_installations_membership_fk" FOREIGN KEY ("membership_id","organization_id") REFERENCES "radius_platform"."organization_memberships"("membership_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."physical_devices" ADD CONSTRAINT "physical_devices_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."physical_devices" ADD CONSTRAINT "physical_devices_assignment_fk" FOREIGN KEY ("assigned_membership_id","organization_id") REFERENCES "radius_platform"."organization_memberships"("membership_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_actor_membership_id_organization_memberships_membership_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "radius_platform"."organization_memberships"("membership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_actor_developer_token_id_developer_tokens_developer_token_id_fk" FOREIGN KEY ("actor_developer_token_id") REFERENCES "radius_platform"."developer_tokens"("developer_token_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_agent_id_agents_agent_id_fk" FOREIGN KEY ("agent_id") REFERENCES "radius_platform"."agents"("agent_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_agent_deployment_id_agent_deployments_agent_deployment_id_fk" FOREIGN KEY ("agent_deployment_id") REFERENCES "radius_platform"."agent_deployments"("agent_deployment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_environment_id_agent_environments_environment_id_fk" FOREIGN KEY ("environment_id") REFERENCES "radius_platform"."agent_environments"("environment_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_agent_environment_revision_id_agent_environment_revisions_agent_environment_revision_id_fk" FOREIGN KEY ("agent_environment_revision_id") REFERENCES "radius_platform"."agent_environment_revisions"("agent_environment_revision_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_physical_device_fk" FOREIGN KEY ("physical_device_id","organization_id") REFERENCES "radius_platform"."physical_devices"("physical_device_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_client_installation_fk" FOREIGN KEY ("client_installation_id","organization_id") REFERENCES "radius_platform"."client_installations"("client_installation_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."audit_events" ADD CONSTRAINT "audit_events_agent_installation_fk" FOREIGN KEY ("agent_installation_id","organization_id") REFERENCES "radius_platform"."agent_installations"("agent_installation_id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."developer_token_scopes" ADD CONSTRAINT "developer_token_scopes_developer_token_id_developer_tokens_developer_token_id_fk" FOREIGN KEY ("developer_token_id") REFERENCES "radius_platform"."developer_tokens"("developer_token_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."developer_tokens" ADD CONSTRAINT "developer_tokens_membership_id_organization_memberships_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "radius_platform"."organization_memberships"("membership_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "radius_platform"."organizations"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radius_platform"."organization_memberships" ADD CONSTRAINT "organization_memberships_account_id_accounts_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "radius_platform"."accounts"("account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_deployment_artifacts_agent_deployment_idx" ON "radius_platform"."agent_deployment_artifacts" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE INDEX "agent_deployment_artifacts_digest_idx" ON "radius_platform"."agent_deployment_artifacts" USING btree ("digest");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_deployment_artifacts_slot_key" ON "radius_platform"."agent_deployment_artifacts" USING btree ("agent_deployment_id","artifact_kind","digest","operating_system","architecture","variant");--> statement-breakpoint
CREATE INDEX "agent_deployment_uploads_agent_created_idx" ON "radius_platform"."agent_deployment_uploads" USING btree ("agent_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_deployment_uploads_environment_idx" ON "radius_platform"."agent_deployment_uploads" USING btree ("requested_environment_id");--> statement-breakpoint
CREATE INDEX "agent_deployment_uploads_state_expiry_idx" ON "radius_platform"."agent_deployment_uploads" USING btree ("upload_state","expires_at");--> statement-breakpoint
CREATE INDEX "agent_deployments_agent_created_idx" ON "radius_platform"."agent_deployments" USING btree ("agent_id","created_at" DESC NULLS LAST,"agent_deployment_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_deployments_state_idx" ON "radius_platform"."agent_deployments" USING btree ("verification_state");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_deployments_agent_version_key" ON "radius_platform"."agent_deployments" USING btree ("agent_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_deployments_upload_key" ON "radius_platform"."agent_deployments" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "agent_environment_revisions_environment_created_idx" ON "radius_platform"."agent_environment_revisions" USING btree ("environment_id","revision" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_environment_revisions_agent_deployment_idx" ON "radius_platform"."agent_environment_revisions" USING btree ("agent_deployment_id") WHERE "radius_platform"."agent_environment_revisions"."agent_deployment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_environment_revisions_environment_revision_key" ON "radius_platform"."agent_environment_revisions" USING btree ("environment_id","revision");--> statement-breakpoint
CREATE INDEX "agent_environments_agent_state_idx" ON "radius_platform"."agent_environments" USING btree ("agent_id","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_environments_agent_slug_key" ON "radius_platform"."agent_environments" USING btree ("agent_id","slug");--> statement-breakpoint
CREATE INDEX "agents_organization_state_idx" ON "radius_platform"."agents" USING btree ("organization_id","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_ref_key" ON "radius_platform"."agents" USING btree ("agent_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_organization_slug_key" ON "radius_platform"."agents" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "developer_token_agents_agent_idx" ON "radius_platform"."developer_token_agents" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "account_identities_account_idx" ON "radius_platform"."account_identities" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_identities_issuer_subject_key" ON "radius_platform"."account_identities" USING btree ("issuer","provider_subject");--> statement-breakpoint
CREATE INDEX "platform_sessions_identity_idx" ON "radius_platform"."platform_sessions" USING btree ("account_identity_id");--> statement-breakpoint
CREATE INDEX "platform_sessions_active_expiry_idx" ON "radius_platform"."platform_sessions" USING btree ("expires_at") WHERE "radius_platform"."platform_sessions"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "platform_sessions_token_hash_key" ON "radius_platform"."platform_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "agent_installation_observations_latest_idx" ON "radius_platform"."agent_installation_observations" USING btree ("agent_installation_id","observed_at" DESC NULLS LAST,"agent_installation_observation_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "agent_installation_observations_deployment_idx" ON "radius_platform"."agent_installation_observations" USING btree ("agent_deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_installation_observations_event_key" ON "radius_platform"."agent_installation_observations" USING btree ("agent_installation_id","client_event_id");--> statement-breakpoint
CREATE INDEX "agent_installations_agent_state_idx" ON "radius_platform"."agent_installations" USING btree ("agent_id","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_installations_client_agent_key" ON "radius_platform"."agent_installations" USING btree ("client_installation_id","agent_id");--> statement-breakpoint
CREATE INDEX "client_installation_observations_latest_idx" ON "radius_platform"."client_installation_observations" USING btree ("client_installation_id","observed_at" DESC NULLS LAST,"client_installation_observation_id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "client_installation_observations_event_key" ON "radius_platform"."client_installation_observations" USING btree ("client_installation_id","client_event_id");--> statement-breakpoint
CREATE INDEX "client_installations_device_state_idx" ON "radius_platform"."client_installations" USING btree ("physical_device_id","lifecycle_state");--> statement-breakpoint
CREATE INDEX "client_installations_membership_state_idx" ON "radius_platform"."client_installations" USING btree ("membership_id","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "client_installations_client_key" ON "radius_platform"."client_installations" USING btree ("client_instance_id");--> statement-breakpoint
CREATE INDEX "physical_devices_organization_state_idx" ON "radius_platform"."physical_devices" USING btree ("organization_id","lifecycle_state");--> statement-breakpoint
CREATE INDEX "physical_devices_membership_idx" ON "radius_platform"."physical_devices" USING btree ("assigned_membership_id") WHERE "radius_platform"."physical_devices"."assigned_membership_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "physical_devices_fingerprint_key" ON "radius_platform"."physical_devices" USING btree ("organization_id","device_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "physical_devices_asset_tag_key" ON "radius_platform"."physical_devices" USING btree ("organization_id","asset_tag");--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_idx" ON "radius_platform"."audit_events" USING btree ("organization_id","occurred_at" DESC NULLS LAST,"audit_event_id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_agent_occurred_idx" ON "radius_platform"."audit_events" USING btree ("agent_id","occurred_at" DESC NULLS LAST) WHERE "radius_platform"."audit_events"."agent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "radius_platform"."audit_events" USING btree ("request_id") WHERE "radius_platform"."audit_events"."request_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_organization_event_key" ON "radius_platform"."audit_events" USING btree ("organization_id","event_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "radius_platform"."idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_authority_operation_key" ON "radius_platform"."idempotency_records" USING btree ("authority_fingerprint","operation_code","idempotency_key");--> statement-breakpoint
CREATE INDEX "job_outbox_ready_idx" ON "radius_platform"."job_outbox_messages" USING btree ("available_at","outbox_message_id") WHERE "radius_platform"."job_outbox_messages"."message_state" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "job_outbox_idempotency_key" ON "radius_platform"."job_outbox_messages" USING btree ("job_idempotency_key");--> statement-breakpoint
CREATE INDEX "developer_tokens_membership_idx" ON "radius_platform"."developer_tokens" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "developer_tokens_hash_key" ON "radius_platform"."developer_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "organization_memberships_account_idx" ON "radius_platform"."organization_memberships" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "organization_memberships_organization_state_idx" ON "radius_platform"."organization_memberships" USING btree ("organization_id","lifecycle_state");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_memberships_account_key" ON "radius_platform"."organization_memberships" USING btree ("organization_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_key" ON "radius_platform"."organizations" USING btree ("slug");