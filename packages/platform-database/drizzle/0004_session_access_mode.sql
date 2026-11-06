ALTER TABLE radius_sync.sessions ADD COLUMN access_mode text NOT NULL DEFAULT 'project' CONSTRAINT sync_sessions_access_mode_check CHECK (access_mode IN ('ask', 'project', 'full'));
