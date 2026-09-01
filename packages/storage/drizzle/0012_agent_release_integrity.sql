PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_authentication_bindings` (
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
	FOREIGN KEY (`requirement_id`,`release_id`) REFERENCES `agent_release_auth_requirements`(`id`,`release_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`,`client_instance_id`) REFERENCES `authentication_accounts`(`id`,`client_instance_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_authentication_bindings_unbound_reason_paired" CHECK(("__new_agent_authentication_bindings"."unbound_at_ms" is null and "__new_agent_authentication_bindings"."unbound_reason" is null) or ("__new_agent_authentication_bindings"."unbound_at_ms" is not null and "__new_agent_authentication_bindings"."unbound_reason" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_agent_authentication_bindings`("id", "client_instance_id", "installation_id", "release_id", "requirement_id", "account_id", "bound_at_ms", "unbound_at_ms", "unbound_reason") SELECT "id", "client_instance_id", "installation_id", "release_id", "requirement_id", "account_id", "bound_at_ms", "unbound_at_ms", "unbound_reason" FROM `agent_authentication_bindings`;--> statement-breakpoint
DROP TABLE `agent_authentication_bindings`;--> statement-breakpoint
ALTER TABLE `__new_agent_authentication_bindings` RENAME TO `agent_authentication_bindings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_authentication_bindings_active_requirement_uq` ON `agent_authentication_bindings` (`installation_id`,`requirement_id`) WHERE "agent_authentication_bindings"."unbound_at_ms" is null;--> statement-breakpoint
DROP INDEX `agent_releases_image_digest_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_releases_image_digest_uq` ON `agent_releases` (`image_digest`);