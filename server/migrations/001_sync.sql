-- Run once as migration owner. The runtime role must NOT own these tables.
CREATE SCHEMA archive_sync;
REVOKE ALL ON SCHEMA archive_sync FROM PUBLIC;
CREATE TABLE archive_sync.migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE archive_sync.counters(owner_uid text PRIMARY KEY, seq bigint NOT NULL DEFAULT 0 CHECK(seq >= 0));
CREATE TABLE archive_sync.entities(
  owner_uid text NOT NULL, entity_key text NOT NULL, revision bigint NOT NULL CHECK(revision > 0),
  seq bigint NOT NULL, payload jsonb, device_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_uid, entity_key)
);
CREATE TABLE archive_sync.changes(
  owner_uid text NOT NULL, seq bigint NOT NULL, entity_key text NOT NULL, revision bigint NOT NULL,
  payload jsonb, device_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner_uid, seq), UNIQUE(owner_uid, entity_key, revision)
);
CREATE TABLE archive_sync.operations(
  owner_uid text NOT NULL, operation_id uuid NOT NULL, request_hash text NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_uid, operation_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['counters','entities','changes','operations'] LOOP
    EXECUTE format('ALTER TABLE archive_sync.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE archive_sync.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_only ON archive_sync.%I USING (owner_uid = current_setting(''archive_sync.uid'', true)) WITH CHECK (owner_uid = current_setting(''archive_sync.uid'', true))', t);
    EXECUTE format('REVOKE ALL ON archive_sync.%I FROM PUBLIC', t);
  END LOOP;
END $$;
INSERT INTO archive_sync.migrations(version) VALUES(1);
-- Grant to a separately provisioned non-owner LOGIN role (no SUPERUSER/BYPASSRLS):
-- GRANT USAGE ON SCHEMA archive_sync TO music_sync_runtime;
-- GRANT SELECT,INSERT,UPDATE ON archive_sync.counters,archive_sync.entities TO music_sync_runtime;
-- GRANT SELECT,INSERT ON archive_sync.changes,archive_sync.operations TO music_sync_runtime;
