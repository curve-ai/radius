DROP INDEX `agent_releases_image_digest_uq`;--> statement-breakpoint
CREATE INDEX `agent_releases_image_digest_idx` ON `agent_releases` (`image_digest`);