ALTER TABLE `connector_identities` ADD `catalog_source` text;--> statement-breakpoint
ALTER TABLE `connector_identities` ADD `catalog_external_id` text;--> statement-breakpoint
ALTER TABLE `connector_identities` ADD `domain` text;--> statement-breakpoint
ALTER TABLE `connector_identities` ADD `logo_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `connector_identities_catalog_uq` ON `connector_identities` (`catalog_source`,`catalog_external_id`) WHERE "connector_identities"."catalog_source" is not null;