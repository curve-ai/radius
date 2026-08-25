GRANT USAGE ON SCHEMA auth, platform, sync, connectors, audit
  TO radius_app, radius_jobs, radius_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth
  TO radius_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, sync, connectors
  TO radius_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform, connectors
  TO radius_jobs;
GRANT SELECT, INSERT ON audit.events TO radius_app, radius_jobs;
GRANT SELECT ON ALL TABLES IN SCHEMA auth, platform, sync, connectors, audit
  TO radius_readonly;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth, platform, sync, connectors, audit
  TO radius_app, radius_jobs;

REVOKE UPDATE, DELETE ON platform.releases,
  platform.release_artifacts,
  platform.deployment_revisions,
  platform.policy_revisions,
  audit.events
  FROM radius_app, radius_jobs;

ALTER DEFAULT PRIVILEGES IN SCHEMA auth, platform, sync, connectors, audit
  GRANT SELECT ON TABLES TO radius_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA auth, platform, sync, connectors, audit
  GRANT USAGE, SELECT ON SEQUENCES TO radius_app, radius_jobs;

DO $radius_rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'organization_memberships',
    'organization_groups',
    'group_memberships',
    'projects',
    'environments',
    'releases',
    'release_revocations',
    'release_artifacts',
    'deployments',
    'deployment_revisions',
    'user_assignments',
    'group_assignments',
    'organization_devices',
    'installation_observations',
    'policies',
    'policy_revisions',
    'policy_project_assignments',
    'policy_group_assignments',
    'policy_membership_assignments',
    'policy_device_assignments',
    'credential_references'
  ] LOOP
    EXECUTE format('ALTER TABLE platform.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON platform.%I USING (organization_id = nullif(current_setting(''radius.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''radius.organization_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;

  ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON audit.events
    USING (organization_id = nullif(current_setting('radius.organization_id', true), '')::uuid)
    WITH CHECK (organization_id = nullif(current_setting('radius.organization_id', true), '')::uuid);

  ALTER TABLE platform.devices ENABLE ROW LEVEL SECURITY;
  CREATE POLICY account_isolation ON platform.devices
    USING (owner_account_id = nullif(current_setting('radius.account_id', true), '')::uuid)
    WITH CHECK (owner_account_id = nullif(current_setting('radius.account_id', true), '')::uuid);

END
$radius_rls$;

DO $radius_account_rls$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workspace_projects',
    'sessions',
    'session_events',
    'messages',
    'message_parts',
    'agent_runs',
    'agent_run_state_updates',
    'agent_run_presentations',
    'reasoning_summaries',
    'task_plans',
    'task_steps',
    'task_step_updates',
    'tool_calls',
    'tool_progress_events',
    'tool_results',
    'approval_requests',
    'approval_decisions',
    'errors',
    'artifacts',
    'file_artifacts',
    'link_artifacts',
    'event_artifacts',
    'workspace_files',
    'workspace_file_versions',
    'file_changes',
    'change_envelopes'
  ] LOOP
    EXECUTE format('ALTER TABLE sync.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY account_isolation ON sync.%I USING (account_id = nullif(current_setting(''radius.account_id'', true), '''')::uuid) WITH CHECK (account_id = nullif(current_setting(''radius.account_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'profile_connectors',
    'profile_connections',
    'profile_changes'
  ] LOOP
    EXECUTE format('ALTER TABLE connectors.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY account_isolation ON connectors.%I USING (account_id = nullif(current_setting(''radius.account_id'', true), '''')::uuid) WITH CHECK (account_id = nullif(current_setting(''radius.account_id'', true), '''')::uuid)',
      table_name
    );
  END LOOP;
END
$radius_account_rls$;
