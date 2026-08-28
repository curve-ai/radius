CREATE TABLE `capability_contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_key` text NOT NULL,
	`contract_version` integer NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	CONSTRAINT "capability_contracts_key_nonempty" CHECK(length(trim("capability_contracts"."capability_key")) > 0),
	CONSTRAINT "capability_contracts_version_positive" CHECK("capability_contracts"."contract_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_contracts_key_version_uq` ON `capability_contracts` (`capability_key`,`contract_version`);--> statement-breakpoint
CREATE TABLE `capability_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`operation_name` text NOT NULL,
	`input_schema_id` text NOT NULL,
	`input_schema_version` integer NOT NULL,
	`output_schema_id` text NOT NULL,
	`output_schema_version` integer NOT NULL,
	`risk_class` text NOT NULL,
	`approval_eligible` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `capability_contracts`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "capability_operations_name_nonempty" CHECK(length(trim("capability_operations"."operation_name")) > 0),
	CONSTRAINT "capability_operations_schema_versions_positive" CHECK("capability_operations"."input_schema_version" > 0 and "capability_operations"."output_schema_version" > 0),
	CONSTRAINT "capability_operations_risk_valid" CHECK("capability_operations"."risk_class" in ('read', 'write', 'external_side_effect', 'privileged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_operations_contract_name_uq` ON `capability_operations` (`contract_id`,`operation_name`);--> statement-breakpoint
CREATE TABLE `connector_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`publisher_key` text NOT NULL,
	`connector_key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text NOT NULL,
	CONSTRAINT "connector_identities_keys_nonempty" CHECK(length(trim("connector_identities"."publisher_key")) > 0 and length(trim("connector_identities"."connector_key")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_identities_publisher_key_uq` ON `connector_identities` (`publisher_key`,`connector_key`);--> statement-breakpoint
CREATE TABLE `connector_installations` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`connector_id` text NOT NULL,
	`selected_release_id` text NOT NULL,
	`profile_connector_id` text,
	`applied_profile_revision` integer,
	`lifecycle_state` text NOT NULL,
	`installed_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connector_id`) REFERENCES `connector_identities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`selected_release_id`) REFERENCES `connector_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`profile_connector_id`) REFERENCES `profile_connectors`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "connector_installations_state_valid" CHECK("connector_installations"."lifecycle_state" in ('staged', 'ready', 'disconnected', 'deleted', 'error')),
	CONSTRAINT "connector_installations_profile_revision_paired" CHECK(("connector_installations"."profile_connector_id" is null and "connector_installations"."applied_profile_revision" is null) or ("connector_installations"."profile_connector_id" is not null and "connector_installations"."applied_profile_revision" > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_installations_client_connector_uq` ON `connector_installations` (`client_instance_id`,`connector_id`);--> statement-breakpoint
CREATE TABLE `connector_release_capability_mappings` (
	`release_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`native_tool_name` text NOT NULL,
	`input_schema_sha256` text NOT NULL,
	`output_schema_sha256` text,
	PRIMARY KEY(`release_id`, `endpoint_id`, `operation_id`),
	FOREIGN KEY (`release_id`) REFERENCES `connector_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`endpoint_id`) REFERENCES `connector_release_endpoints`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `capability_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "connector_release_mappings_input_hash_valid" CHECK(length("connector_release_capability_mappings"."input_schema_sha256") = 64 and "connector_release_capability_mappings"."input_schema_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "connector_release_mappings_output_hash_valid" CHECK("connector_release_capability_mappings"."output_schema_sha256" is null or (length("connector_release_capability_mappings"."output_schema_sha256") = 64 and "connector_release_capability_mappings"."output_schema_sha256" not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE TABLE `connector_release_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`endpoint_key` text NOT NULL,
	`transport` text NOT NULL,
	`endpoint_url` text NOT NULL,
	`authentication` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `connector_releases`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "connector_release_endpoints_transport_valid" CHECK("connector_release_endpoints"."transport" = 'streamable_http'),
	CONSTRAINT "connector_release_endpoints_auth_valid" CHECK("connector_release_endpoints"."authentication" in ('none', 'oauth', 'bearer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_release_endpoints_key_uq` ON `connector_release_endpoints` (`release_id`,`endpoint_key`);--> statement-breakpoint
CREATE TABLE `connector_releases` (
	`id` text PRIMARY KEY NOT NULL,
	`connector_id` text NOT NULL,
	`version` text NOT NULL,
	`manifest_sha256` text NOT NULL,
	`minimum_host_version` text NOT NULL,
	`published_at_ms` integer NOT NULL,
	`revoked_at_ms` integer,
	`revocation_reason` text,
	FOREIGN KEY (`connector_id`) REFERENCES `connector_identities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "connector_releases_manifest_hash_valid" CHECK(length("connector_releases"."manifest_sha256") = 64 and "connector_releases"."manifest_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "connector_releases_revocation_paired" CHECK(("connector_releases"."revoked_at_ms" is null and "connector_releases"."revocation_reason" is null) or ("connector_releases"."revoked_at_ms" is not null and length(trim("connector_releases"."revocation_reason")) > 0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_releases_connector_version_uq` ON `connector_releases` (`connector_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `connector_releases_manifest_uq` ON `connector_releases` (`manifest_sha256`);--> statement-breakpoint
CREATE TABLE `profile_connector_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_connector_id` text NOT NULL,
	`revision` integer NOT NULL,
	`endpoint_key` text NOT NULL,
	`account_label` text,
	`remote_subject` text,
	`origin_client_instance_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`profile_connector_id`) REFERENCES `profile_connectors`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "profile_connector_connections_revision_positive" CHECK("profile_connector_connections"."revision" > 0)
);
--> statement-breakpoint
CREATE INDEX `profile_connector_connections_connector_idx` ON `profile_connector_connections` (`profile_connector_id`);--> statement-breakpoint
CREATE TABLE `profile_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_subject` text NOT NULL,
	`connector_id` text NOT NULL,
	`revision` integer NOT NULL,
	`release_selection_mode` text NOT NULL,
	`release_selection_value` text NOT NULL,
	`origin_client_instance_id` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	`deleted_at_ms` integer,
	FOREIGN KEY (`connector_id`) REFERENCES `connector_identities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_client_instance_id`) REFERENCES `client_instances`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "profile_connectors_revision_positive" CHECK("profile_connectors"."revision" > 0),
	CONSTRAINT "profile_connectors_selection_mode_valid" CHECK("profile_connectors"."release_selection_mode" in ('exact', 'channel'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profile_connectors_subject_connector_uq` ON `profile_connectors` (`profile_subject`,`connector_id`);--> statement-breakpoint
CREATE TABLE `tool_bindings` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`native_tool_name` text NOT NULL,
	`input_schema_sha256` text NOT NULL,
	`output_schema_sha256` text,
	`enabled` integer DEFAULT false NOT NULL,
	`discovered_at_ms` integer NOT NULL,
	`disabled_at_ms` integer,
	FOREIGN KEY (`provider_id`) REFERENCES `tool_providers`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`operation_id`) REFERENCES `capability_operations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "tool_bindings_input_hash_valid" CHECK(length("tool_bindings"."input_schema_sha256") = 64 and "tool_bindings"."input_schema_sha256" not glob '*[^0-9a-f]*'),
	CONSTRAINT "tool_bindings_output_hash_valid" CHECK("tool_bindings"."output_schema_sha256" is null or (length("tool_bindings"."output_schema_sha256") = 64 and "tool_bindings"."output_schema_sha256" not glob '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_bindings_provider_tool_schema_uq` ON `tool_bindings` (`provider_id`,`native_tool_name`,`input_schema_sha256`);--> statement-breakpoint
CREATE TABLE `tool_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`endpoint_id` text NOT NULL,
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
	CONSTRAINT "tool_providers_state_valid" CHECK("tool_providers"."connection_state" in ('needs_authentication', 'connected', 'disconnected', 'error')),
	CONSTRAINT "tool_providers_profile_revision_paired" CHECK(("tool_providers"."profile_connection_id" is null and "tool_providers"."applied_profile_revision" is null) or ("tool_providers"."profile_connection_id" is not null and "tool_providers"."applied_profile_revision" > 0)),
	CONSTRAINT "tool_providers_credential_connected" CHECK("tool_providers"."connection_state" <> 'connected' or "tool_providers"."credential_ref" is not null or "tool_providers"."connected_at_ms" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tool_providers_client_key_uq` ON `tool_providers` (`client_instance_id`,`provider_key`);