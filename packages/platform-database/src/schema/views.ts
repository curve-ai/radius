import {
  bigint,
  integer,
  jsonb,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { radiusPlatform } from "./common.js";

export const currentAgentEnvironmentDeployments = radiusPlatform
  .view("current_agent_environment_deployments", {
    environmentId: uuid("environment_id"),
    agentId: uuid("agent_id"),
    environmentSlug: text("environment_slug"),
    agentEnvironmentRevisionId: uuid("agent_environment_revision_id"),
    revision: bigint("revision", { mode: "number" }),
    actionCode: text("action_code"),
    agentDeploymentId: uuid("agent_deployment_id"),
    agentDeploymentVersion: text("agent_deployment_version"),
    imageDigest: text("image_digest"),
    verificationState: text("verification_state"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  })
  .existing();

export const organizationAgentInventory = radiusPlatform
  .view("organization_agent_inventory", {
    organizationId: uuid("organization_id"),
    organizationSlug: text("organization_slug"),
    agentId: uuid("agent_id"),
    agentRef: text("agent_ref"),
    agentSlug: text("agent_slug"),
    agentDisplayName: text("agent_display_name"),
    environmentId: uuid("environment_id"),
    environmentSlug: text("environment_slug"),
    agentEnvironmentRevisionId: uuid("agent_environment_revision_id"),
    deploymentRevision: bigint("deployment_revision", { mode: "number" }),
    agentDeploymentId: uuid("agent_deployment_id"),
    agentDeploymentVersion: text("agent_deployment_version"),
    imageDigest: text("image_digest"),
    verificationState: text("verification_state"),
  })
  .existing();

export const agentDeploymentEvidence = radiusPlatform
  .view("agent_deployment_evidence", {
    agentDeploymentId: uuid("agent_deployment_id"),
    agentId: uuid("agent_id"),
    version: text("version"),
    verificationState: text("verification_state"),
    agentDeploymentArtifactId: uuid("agent_deployment_artifact_id"),
    artifactKind: text("artifact_kind"),
    providerReference: text("provider_reference"),
    digest: text("digest"),
    mediaType: text("media_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    operatingSystem: text("operating_system"),
    architecture: text("architecture"),
    variant: text("variant"),
  })
  .existing();

export const readyJobOutbox = radiusPlatform
  .view("ready_job_outbox", {
    outboxMessageId: uuid("outbox_message_id"),
    aggregateCode: text("aggregate_code"),
    aggregateId: uuid("aggregate_id"),
    jobName: text("job_name"),
    jobVersion: smallint("job_version"),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    jobIdempotencyKey: text("job_idempotency_key"),
    attemptCount: integer("attempt_count"),
    availableAt: timestamp("available_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
  })
  .existing();
