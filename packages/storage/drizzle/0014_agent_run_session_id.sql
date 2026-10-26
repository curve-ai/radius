-- One column was carrying two different facts.
--
-- `provider_run_id` is unique because a run happens once, but the ACP session
-- id was being written into it. A session spans every turn of a conversation,
-- so the second message always collided with the first and the run could not
-- be recorded — the agent answered and Radius reported that it could not be
-- started. Only agents advertising session resume reused an id, which is why
-- simpler agents never showed it.
--
-- The session id gets its own column, indexed for lookup and not unique.
ALTER TABLE `agent_runs` ADD `provider_session_id` text;--> statement-breakpoint

-- Existing rows hold a session id in the run column. Move it, so the history
-- means what the new columns say it means rather than staying ambiguous.
UPDATE `agent_runs` SET `provider_session_id` = `provider_run_id` WHERE `provider_run_id` IS NOT NULL;--> statement-breakpoint
UPDATE `agent_runs` SET `provider_run_id` = NULL;--> statement-breakpoint

CREATE INDEX `agent_runs_provider_session_idx` ON `agent_runs` (`provider_key`,`provider_session_id`);
