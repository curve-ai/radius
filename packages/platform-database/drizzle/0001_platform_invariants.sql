CREATE FUNCTION radius_platform.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = clock_timestamp();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION radius_platform.prevent_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION radius_platform.enforce_agent_deployment_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    OLD.agent_id,
    OLD.upload_id,
    OLD.version,
    OLD.agent_config_version,
    OLD.agent_manifest_version,
    OLD.minimum_desktop_version,
    OLD.runtime_protocol_version,
    OLD.image_digest,
    OLD.source_manifest_digest,
    OLD.bundle_sha256,
    OLD.created_at
  ) IS DISTINCT FROM ROW(
    NEW.agent_id,
    NEW.upload_id,
    NEW.version,
    NEW.agent_config_version,
    NEW.agent_manifest_version,
    NEW.minimum_desktop_version,
    NEW.runtime_protocol_version,
    NEW.image_digest,
    NEW.source_manifest_digest,
    NEW.bundle_sha256,
    NEW.created_at
  ) THEN
    RAISE EXCEPTION 'agent deployment content is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NOT (
    (OLD.verification_state = 'pending' AND NEW.verification_state IN ('pending', 'verified', 'quarantined'))
    OR (OLD.verification_state = 'verified' AND NEW.verification_state IN ('verified', 'revoked'))
    OR (OLD.verification_state = 'quarantined' AND NEW.verification_state IN ('quarantined', 'revoked'))
    OR (OLD.verification_state = 'revoked' AND NEW.verification_state = 'revoked')
  ) THEN
    RAISE EXCEPTION 'invalid agent deployment verification transition: % -> %',
      OLD.verification_state,
      NEW.verification_state
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.verification_completed_at IS NOT NULL
    AND OLD.verification_completed_at IS DISTINCT FROM NEW.verification_completed_at
  THEN
    RAISE EXCEPTION 'agent deployment verification completion time is immutable'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP INDEX radius_platform.agent_deployment_artifacts_slot_key;
--> statement-breakpoint
ALTER TABLE radius_platform.agent_deployment_artifacts
  ADD CONSTRAINT agent_deployment_artifacts_slot_key
  UNIQUE NULLS NOT DISTINCT (
    agent_deployment_id,
    artifact_kind,
    digest,
    operating_system,
    architecture,
    variant
  );
--> statement-breakpoint
CREATE TRIGGER accounts_set_updated_at
BEFORE UPDATE ON radius_platform.accounts
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON radius_platform.organizations
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER organization_memberships_set_updated_at
BEFORE UPDATE ON radius_platform.organization_memberships
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agents_set_updated_at
BEFORE UPDATE ON radius_platform.agents
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agent_environments_set_updated_at
BEFORE UPDATE ON radius_platform.agent_environments
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agent_deployment_uploads_set_updated_at
BEFORE UPDATE ON radius_platform.agent_deployment_uploads
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER physical_devices_set_updated_at
BEFORE UPDATE ON radius_platform.physical_devices
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER client_installations_set_updated_at
BEFORE UPDATE ON radius_platform.client_installations
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agent_installations_set_updated_at
BEFORE UPDATE ON radius_platform.agent_installations
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER job_outbox_set_updated_at
BEFORE UPDATE ON radius_platform.job_outbox_messages
FOR EACH ROW EXECUTE FUNCTION radius_platform.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER agent_deployments_enforce_update
BEFORE UPDATE ON radius_platform.agent_deployments
FOR EACH ROW EXECUTE FUNCTION radius_platform.enforce_agent_deployment_update();
--> statement-breakpoint
CREATE TRIGGER agent_deployment_artifacts_prevent_update
BEFORE UPDATE OR DELETE ON radius_platform.agent_deployment_artifacts
FOR EACH ROW EXECUTE FUNCTION radius_platform.prevent_row_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_environment_revisions_prevent_update
BEFORE UPDATE OR DELETE ON radius_platform.agent_environment_revisions
FOR EACH ROW EXECUTE FUNCTION radius_platform.prevent_row_mutation();
--> statement-breakpoint
CREATE TRIGGER client_installation_observations_prevent_update
BEFORE UPDATE OR DELETE ON radius_platform.client_installation_observations
FOR EACH ROW EXECUTE FUNCTION radius_platform.prevent_row_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_installation_observations_prevent_update
BEFORE UPDATE OR DELETE ON radius_platform.agent_installation_observations
FOR EACH ROW EXECUTE FUNCTION radius_platform.prevent_row_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_events_prevent_update
BEFORE UPDATE OR DELETE ON radius_platform.audit_events
FOR EACH ROW EXECUTE FUNCTION radius_platform.prevent_row_mutation();
--> statement-breakpoint
CREATE VIEW radius_platform.current_agent_environment_deployments AS
SELECT
  environment.environment_id,
  environment.agent_id,
  environment.slug AS environment_slug,
  revision.agent_environment_revision_id,
  revision.revision,
  revision.action_code,
  revision.agent_deployment_id,
  agent_deployment.version AS agent_deployment_version,
  agent_deployment.image_digest,
  agent_deployment.verification_state,
  revision.created_at
FROM radius_platform.agent_environments AS environment
LEFT JOIN LATERAL (
  SELECT candidate.*
  FROM radius_platform.agent_environment_revisions AS candidate
  WHERE candidate.environment_id = environment.environment_id
  ORDER BY candidate.revision DESC
  LIMIT 1
) AS revision ON TRUE
LEFT JOIN radius_platform.agent_deployments AS agent_deployment
  ON agent_deployment.agent_deployment_id = revision.agent_deployment_id;
--> statement-breakpoint
CREATE VIEW radius_platform.organization_agent_inventory AS
SELECT
  organization.organization_id,
  organization.slug AS organization_slug,
  agent.agent_id,
  agent.agent_ref,
  agent.slug AS agent_slug,
  agent.display_name AS agent_display_name,
  environment.environment_id,
  environment.slug AS environment_slug,
  deployment.agent_environment_revision_id,
  deployment.revision AS deployment_revision,
  deployment.agent_deployment_id,
  deployment.agent_deployment_version,
  deployment.image_digest,
  deployment.verification_state
FROM radius_platform.organizations AS organization
JOIN radius_platform.agents AS agent
  ON agent.organization_id = organization.organization_id
JOIN radius_platform.agent_environments AS environment
  ON environment.agent_id = agent.agent_id
LEFT JOIN radius_platform.current_agent_environment_deployments AS deployment
  ON deployment.environment_id = environment.environment_id;
--> statement-breakpoint
CREATE VIEW radius_platform.agent_deployment_evidence AS
SELECT
  agent_deployment.agent_deployment_id,
  agent_deployment.agent_id,
  agent_deployment.version,
  agent_deployment.verification_state,
  artifact.agent_deployment_artifact_id,
  artifact.artifact_kind,
  artifact.provider_reference,
  artifact.digest,
  artifact.media_type,
  artifact.byte_size,
  artifact.operating_system,
  artifact.architecture,
  artifact.variant
FROM radius_platform.agent_deployments AS agent_deployment
LEFT JOIN radius_platform.agent_deployment_artifacts AS artifact
  ON artifact.agent_deployment_id = agent_deployment.agent_deployment_id;
--> statement-breakpoint
CREATE VIEW radius_platform.ready_job_outbox AS
SELECT
  outbox_message_id,
  aggregate_code,
  aggregate_id,
  job_name,
  job_version,
  payload,
  job_idempotency_key,
  attempt_count,
  available_at,
  created_at
FROM radius_platform.job_outbox_messages
WHERE message_state = 'pending'
  AND available_at <= clock_timestamp();
