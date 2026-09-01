CREATE TABLE `mcp_server_approval_grant_revocations` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`revoked_at_ms` integer NOT NULL,
	`actor_type` text NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `mcp_server_approval_grants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "mcp_server_approval_grant_revocations_actor_valid" CHECK("mcp_server_approval_grant_revocations"."actor_type" = 'local_user')
);
--> statement-breakpoint
CREATE TABLE `mcp_server_approval_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`granted_at_ms` integer NOT NULL,
	`actor_type` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `tool_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "mcp_server_approval_grants_actor_valid" CHECK("mcp_server_approval_grants"."actor_type" = 'local_user')
);
--> statement-breakpoint
CREATE INDEX `mcp_server_approval_grants_provider_idx` ON `mcp_server_approval_grants` (`provider_id`);--> statement-breakpoint
CREATE TABLE `mcp_tool_approval_grant_revocations` (
	`grant_id` text PRIMARY KEY NOT NULL,
	`revoked_at_ms` integer NOT NULL,
	`actor_type` text NOT NULL,
	FOREIGN KEY (`grant_id`) REFERENCES `mcp_tool_approval_grants`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "mcp_tool_approval_grant_revocations_actor_valid" CHECK("mcp_tool_approval_grant_revocations"."actor_type" = 'local_user')
);
--> statement-breakpoint
CREATE TABLE `mcp_tool_approval_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`tool_binding_id` text NOT NULL,
	`granted_at_ms` integer NOT NULL,
	`actor_type` text NOT NULL,
	FOREIGN KEY (`tool_binding_id`) REFERENCES `tool_bindings`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "mcp_tool_approval_grants_actor_valid" CHECK("mcp_tool_approval_grants"."actor_type" = 'local_user')
);
--> statement-breakpoint
CREATE INDEX `mcp_tool_approval_grants_binding_idx` ON `mcp_tool_approval_grants` (`tool_binding_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tool_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`installation_id` text,
	`endpoint_id` text,
	`profile_connection_id` text,
	`applied_profile_revision` integer,
	`provider_key` text NOT NULL,
	`label` text NOT NULL,
	`credential_ref` text,
	`connection_state` text NOT NULL,
	`connected_at_ms` integer,
	`disconnected_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`installation_id`) REFERENCES `connector_installations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`endpoint_id`) REFERENCES `connector_release_endpoints`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`profile_connection_id`) REFERENCES `profile_connector_connections`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tool_providers_state_valid" CHECK("__new_tool_providers"."connection_state" in ('needs_authentication', 'connected', 'disconnected', 'error')),
	CONSTRAINT "tool_providers_profile_revision_paired" CHECK(("__new_tool_providers"."profile_connection_id" is null and "__new_tool_providers"."applied_profile_revision" is null) or ("__new_tool_providers"."profile_connection_id" is not null and "__new_tool_providers"."applied_profile_revision" > 0)),
	CONSTRAINT "tool_providers_connector_origin_paired" CHECK(("__new_tool_providers"."installation_id" is null and "__new_tool_providers"."endpoint_id" is null) or ("__new_tool_providers"."installation_id" is not null and "__new_tool_providers"."endpoint_id" is not null)),
	CONSTRAINT "tool_providers_credential_connected" CHECK("__new_tool_providers"."connection_state" <> 'connected' or "__new_tool_providers"."credential_ref" is not null or "__new_tool_providers"."connected_at_ms" is not null)
);
--> statement-breakpoint
INSERT INTO `__new_tool_providers`("id", "client_instance_id", "installation_id", "endpoint_id", "profile_connection_id", "applied_profile_revision", "provider_key", "label", "credential_ref", "connection_state", "connected_at_ms", "disconnected_at_ms", "updated_at_ms") SELECT "id", "client_instance_id", "installation_id", "endpoint_id", "profile_connection_id", "applied_profile_revision", "provider_key", "label", "credential_ref", "connection_state", "connected_at_ms", "disconnected_at_ms", "updated_at_ms" FROM `tool_providers`;--> statement-breakpoint
DROP TABLE `tool_providers`;--> statement-breakpoint
ALTER TABLE `__new_tool_providers` RENAME TO `tool_providers`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tool_providers_client_key_uq` ON `tool_providers` (`client_instance_id`,`provider_key`);