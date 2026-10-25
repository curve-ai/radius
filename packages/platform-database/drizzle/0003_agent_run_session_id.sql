-- Mirrors the workspace split: one column was carrying two different facts.
--
-- `provider_run_id` is unique because a run happens once, but the ACP session
-- id was written into it, and a session spans every turn of a conversation.
-- The second message of any resumable conversation therefore collided with
-- the first. The session id gets its own column, indexed and not unique.
ALTER TABLE "radius_sync"."agent_runs" ADD COLUMN "provider_session_id" text;--> statement-breakpoint

-- Rows synced before the split hold a session id in the run column.
UPDATE "radius_sync"."agent_runs" SET "provider_session_id" = "provider_run_id" WHERE "provider_run_id" IS NOT NULL;--> statement-breakpoint
UPDATE "radius_sync"."agent_runs" SET "provider_run_id" = NULL;--> statement-breakpoint

CREATE INDEX "sync_agent_runs_provider_session_idx" ON "radius_sync"."agent_runs" ("provider_key","provider_session_id");
