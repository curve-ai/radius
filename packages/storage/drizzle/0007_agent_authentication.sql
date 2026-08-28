CREATE TABLE `agent_authentication_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`release_id` text NOT NULL,
	`requirement_id` text NOT NULL,
	`account_id` text NOT NULL,
	`bound_at_ms` integer NOT NULL,
	`unbound_at_ms` integer,
	`unbound_reason` text,
	FOREIGN KEY (`installation_id`,`client_instance_id`) REFERENCES `agent_installations`(`id`,`client_instance_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`installation_id`,`release_id`) REFERENCES `agent_installations`(`id`,`selected_release_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`requirement_id`,`release_id`) REFERENCES `agent_release_auth_requirements`(`id`,`release_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`,`client_instance_id`) REFERENCES `authentication_accounts`(`id`,`client_instance_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_authentication_bindings_unbound_reason_paired" CHECK(("agent_authentication_bindings"."unbound_at_ms" is null and "agent_authentication_bindings"."unbound_reason" is null) or ("agent_authentication_bindings"."unbound_at_ms" is not null and "agent_authentication_bindings"."unbound_reason" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_authentication_bindings_active_requirement_uq` ON `agent_authentication_bindings` (`installation_id`,`requirement_id`) WHERE "agent_authentication_bindings"."unbound_at_ms" is null;--> statement-breakpoint
CREATE TABLE `agent_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_key` text NOT NULL,
	`agent_key` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "agent_identities_keys_nonempty" CHECK(length(trim("agent_identities"."provider_key")) > 0 and length(trim("agent_identities"."agent_key")) > 0),
	CONSTRAINT "agent_identities_name_nonempty" CHECK(length(trim("agent_identities"."display_name")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identities_provider_agent_uq` ON `agent_identities` (`provider_key`,`agent_key`);--> statement-breakpoint
CREATE TABLE `agent_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`selected_release_id` text NOT NULL,
	`lifecycle_state` text NOT NULL,
	`installed_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_identities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_release_id`) REFERENCES `agent_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_installations_state_valid" CHECK("agent_installations"."lifecycle_state" in ('staged', 'ready', 'disabled', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installations_client_agent_uq` ON `agent_installations` (`client_instance_id`,`agent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installations_id_client_uq` ON `agent_installations` (`id`,`client_instance_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_installations_id_release_uq` ON `agent_installations` (`id`,`selected_release_id`);--> statement-breakpoint
CREATE TABLE `agent_release_auth_requirement_custody_kinds` (
	`requirement_id` text NOT NULL,
	`custody_kind` text NOT NULL,
	PRIMARY KEY(`requirement_id`, `custody_kind`),
	FOREIGN KEY (`requirement_id`) REFERENCES `agent_release_auth_requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_release_auth_requirement_custody_kind_valid" CHECK("agent_release_auth_requirement_custody_kinds"."custody_kind" in ('os_vault', 'encrypted_agent_state', 'managed_exchange', 'none'))
);
--> statement-breakpoint
CREATE TABLE `agent_release_auth_requirement_scopes` (
	`requirement_id` text NOT NULL,
	`scope` text NOT NULL,
	`requirement` text NOT NULL,
	PRIMARY KEY(`requirement_id`, `scope`),
	FOREIGN KEY (`requirement_id`) REFERENCES `agent_release_auth_requirements`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_release_auth_requirement_scopes_requirement_valid" CHECK("agent_release_auth_requirement_scopes"."requirement" in ('required', 'optional'))
);
--> statement-breakpoint
CREATE TABLE `agent_release_auth_requirements` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`requirement_key` text NOT NULL,
	`authority_flow_id` text NOT NULL,
	`requirement` text NOT NULL,
	`portability` text NOT NULL,
	`runtime_delivery` text NOT NULL,
	`manifest_position` integer NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `agent_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authority_flow_id`) REFERENCES `authentication_authority_flows`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_release_auth_requirements_requirement_valid" CHECK("agent_release_auth_requirements"."requirement" in ('required', 'optional')),
	CONSTRAINT "agent_release_auth_requirements_portability_valid" CHECK("agent_release_auth_requirements"."portability" in ('device_only', 'profile_binding')),
	CONSTRAINT "agent_release_auth_requirements_delivery_valid" CHECK("agent_release_auth_requirements"."runtime_delivery" in ('agent_state_adapter', 'short_lived_token', 'host_handle')),
	CONSTRAINT "agent_release_auth_requirements_position_nonnegative" CHECK("agent_release_auth_requirements"."manifest_position" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_release_auth_requirements_release_key_uq` ON `agent_release_auth_requirements` (`release_id`,`requirement_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_release_auth_requirements_id_release_uq` ON `agent_release_auth_requirements` (`id`,`release_id`);--> statement-breakpoint
CREATE TABLE `agent_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`release_version` text NOT NULL,
	`image_digest` text NOT NULL,
	`manifest_sha256` text NOT NULL,
	`protocol_kind` text NOT NULL,
	`protocol_version` integer NOT NULL,
	`verified_at_ms` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_identities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_releases_version_nonempty" CHECK(length(trim("agent_releases"."release_version")) > 0),
	CONSTRAINT "agent_releases_image_digest_valid" CHECK(length("agent_releases"."image_digest") = 71 and substr("agent_releases"."image_digest", 1, 7) = 'sha256:' and substr("agent_releases"."image_digest", 8) not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_releases_manifest_hash_valid" CHECK(length("agent_releases"."manifest_sha256") = 64 and "agent_releases"."manifest_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "agent_releases_protocol_version_positive" CHECK("agent_releases"."protocol_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_releases_agent_version_uq` ON `agent_releases` (`agent_id`,`release_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_releases_image_digest_uq` ON `agent_releases` (`image_digest`);--> statement-breakpoint
CREATE TABLE `authentication_account_granted_scopes` (
	`account_id` text NOT NULL,
	`scope` text NOT NULL,
	`observed_at_ms` integer NOT NULL,
	PRIMARY KEY(`account_id`, `scope`),
	FOREIGN KEY (`account_id`) REFERENCES `authentication_accounts`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `authentication_account_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`event_kind` text NOT NULL,
	`result_code` text NOT NULL,
	`entitlement_revision` text,
	`observed_at_ms` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `authentication_accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "authentication_account_observations_kind_valid" CHECK("authentication_account_observations"."event_kind" in ('connected', 'refreshed', 'expired', 'revoked', 'disconnected', 'error'))
);
--> statement-breakpoint
CREATE INDEX `authentication_account_observations_account_time_idx` ON `authentication_account_observations` (`account_id`,`observed_at_ms`);--> statement-breakpoint
CREATE TABLE `authentication_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`authority_flow_id` text NOT NULL,
	`custody_kind` text NOT NULL,
	`connection_state` text NOT NULL,
	`credential_ref` text,
	`remote_subject` text,
	`tenant_subject` text,
	`account_label` text,
	`expires_at_ms` integer,
	`connected_at_ms` integer,
	`disconnected_at_ms` integer,
	`revoked_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`authority_flow_id`) REFERENCES `authentication_authority_flows`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "authentication_accounts_custody_kind_valid" CHECK("authentication_accounts"."custody_kind" in ('os_vault', 'encrypted_agent_state', 'managed_exchange', 'none')),
	CONSTRAINT "authentication_accounts_state_valid" CHECK("authentication_accounts"."connection_state" in ('needs_authentication', 'connected', 'expired', 'revoked', 'disconnected', 'error')),
	CONSTRAINT "authentication_accounts_connected_credential_valid" CHECK("authentication_accounts"."connection_state" <> 'connected' or "authentication_accounts"."custody_kind" in ('managed_exchange', 'none') or "authentication_accounts"."credential_ref" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authentication_accounts_id_client_uq` ON `authentication_accounts` (`id`,`client_instance_id`);--> statement-breakpoint
CREATE INDEX `authentication_accounts_client_authority_idx` ON `authentication_accounts` (`client_instance_id`,`authority_flow_id`);--> statement-breakpoint
CREATE TABLE `authentication_authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`authority_key` text NOT NULL,
	`purpose` text NOT NULL,
	`canonical_issuer` text,
	`display_name` text NOT NULL,
	CONSTRAINT "authentication_authorities_purpose_valid" CHECK("authentication_authorities"."purpose" in ('vendor_identity', 'model_provider', 'router'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authentication_authorities_key_uq` ON `authentication_authorities` (`authority_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `authentication_authorities_issuer_uq` ON `authentication_authorities` (`canonical_issuer`) WHERE "authentication_authorities"."canonical_issuer" is not null;--> statement-breakpoint
CREATE TABLE `authentication_authority_flows` (
	`id` text PRIMARY KEY NOT NULL,
	`authority_id` text NOT NULL,
	`flow_key` text NOT NULL,
	`flow_kind` text NOT NULL,
	`public_client_id` text,
	`token_audience` text,
	`device_binding_supported` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`authority_id`) REFERENCES `authentication_authorities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "authentication_authority_flows_kind_valid" CHECK("authentication_authority_flows"."flow_kind" in ('oidc_pkce', 'oauth_pkce', 'device_authorization', 'api_key', 'vendor_token_exchange', 'provider_native_oauth'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `authentication_authority_flows_authority_key_uq` ON `authentication_authority_flows` (`authority_id`,`flow_key`);