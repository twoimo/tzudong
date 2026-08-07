-- Authoritative release-smoke session-family revocation. This migration is intentionally
-- one-shot: pre-created objects are drift, not a successful prior install.
DO $$
DECLARE sessions_id_type text; sessions_user_id_type text; refresh_session_id_type text; refresh_token_type text; refresh_token_not_null boolean;
BEGIN
  IF to_regclass('auth.sessions') IS NULL OR to_regclass('auth.refresh_tokens') IS NULL THEN
    RAISE EXCEPTION 'supported GoTrue session tables are unavailable' USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'supported SHA-256 digest function is unavailable' USING ERRCODE = '55000';
  END IF;
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO sessions_id_type FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'auth.sessions'::regclass AND a.attname = 'id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO sessions_user_id_type FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'auth.sessions'::regclass AND a.attname = 'user_id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) INTO refresh_session_id_type FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'auth.refresh_tokens'::regclass AND a.attname = 'session_id' AND a.attnum > 0 AND NOT a.attisdropped;
  SELECT pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull INTO refresh_token_type, refresh_token_not_null FROM pg_catalog.pg_attribute a WHERE a.attrelid = 'auth.refresh_tokens'::regclass AND a.attname = 'token' AND a.attnum > 0 AND NOT a.attisdropped;
  IF sessions_id_type IS DISTINCT FROM 'uuid' OR sessions_user_id_type IS DISTINCT FROM 'uuid' OR refresh_session_id_type IS DISTINCT FROM 'uuid' OR refresh_token_type IS DISTINCT FROM 'character varying(255)' OR refresh_token_not_null IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'supported GoTrue session column contract changed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_attribute source_column ON source_column.attrelid = c.conrelid AND source_column.attnum = c.conkey[1] JOIN pg_catalog.pg_attribute target_column ON target_column.attrelid = c.confrelid AND target_column.attnum = c.confkey[1] WHERE c.contype = 'f' AND c.conrelid = 'auth.refresh_tokens'::regclass AND c.confrelid = 'auth.sessions'::regclass AND pg_catalog.array_length(c.conkey, 1) = 1 AND pg_catalog.array_length(c.confkey, 1) = 1 AND source_column.attname = 'session_id' AND target_column.attname = 'id') THEN
    RAISE EXCEPTION 'supported GoTrue refresh-token session relationship changed' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE public.release_auth_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE UNIQUE INDEX release_auth_identities_single_enabled_idx ON public.release_auth_identities ((enabled)) WHERE enabled;
CREATE TABLE public.release_auth_session_leases (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  refresh_sha256 text NOT NULL CHECK (refresh_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (user_id, session_id)
);
CREATE TABLE public.release_auth_revocation_receipts (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL,
  binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('revoked_verified', 'expired_reclaimed')),
  refresh_tokens_deleted bigint NOT NULL CHECK (refresh_tokens_deleted >= 0),
  sessions_deleted integer NOT NULL CHECK (sessions_deleted >= 0),
  revoked_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (user_id, session_id)
);
ALTER TABLE public.release_auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_auth_session_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_auth_revocation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.release_auth_identities FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.release_auth_session_leases FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.release_auth_revocation_receipts FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.preflight_release_auth_session_family(p_operation_id uuid, p_user_id uuid, p_session_id uuid, p_refresh_sha256 text, p_expires_at bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE enabled_count bigint; enabled_user_id uuid; matching_refresh_count bigint; lease public.release_auth_session_leases%ROWTYPE; lease_expiry timestamptz; now_timestamp timestamptz := pg_catalog.clock_timestamp(); reclaimed_refresh_count bigint := 0; reclaimed_session_count integer := 0; reclaimed_timestamp timestamptz;
BEGIN
  IF COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF p_operation_id IS NULL OR p_user_id IS NULL OR p_session_id IS NULL OR p_refresh_sha256 !~ '^[0-9a-f]{64}$' OR p_expires_at IS NULL OR p_expires_at <= EXTRACT(EPOCH FROM now_timestamp) OR p_expires_at - EXTRACT(EPOCH FROM now_timestamp) > 900 THEN RAISE EXCEPTION 'operation, bound identity, refresh digest, and bounded expiry are required' USING ERRCODE = '22023'; END IF;
  lease_expiry := pg_catalog.to_timestamp(p_expires_at);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 0));
  SELECT * INTO lease FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF lease.user_id IS DISTINCT FROM p_user_id OR lease.session_id IS DISTINCT FROM p_session_id OR lease.refresh_sha256 IS DISTINCT FROM p_refresh_sha256 OR lease.expires_at IS DISTINCT FROM lease_expiry THEN RAISE EXCEPTION 'operation lease mismatch' USING ERRCODE = '23505'; END IF;
    IF lease.expires_at <= now_timestamp OR NOT EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id) OR (SELECT count(*) FROM auth.refresh_tokens r WHERE r.session_id = p_session_id AND pg_catalog.encode(extensions.digest('tzudong:release-auth-refresh-binding:v1' || pg_catalog.chr(10) || r.token, 'sha256'), 'hex') = p_refresh_sha256) <> 1 THEN RAISE EXCEPTION 'release lease is no longer bound' USING ERRCODE = 'P0002'; END IF;
    RETURN pg_catalog.jsonb_build_object('schemaVersion', 2, 'status', 'compatible_bound', 'dedicatedIdentity', true, 'sessionBound', true, 'refreshBound', true, 'leaseActive', true, 'operationId', p_operation_id::text, 'expiresAt', p_expires_at);
  END IF;
  SELECT * INTO lease FROM public.release_auth_session_leases l WHERE l.user_id = p_user_id AND l.session_id = p_session_id FOR UPDATE;
  IF FOUND THEN
    IF lease.expires_at > now_timestamp THEN RAISE EXCEPTION 'session lease conflict' USING ERRCODE = '23505'; END IF;
    DELETE FROM auth.refresh_tokens r WHERE r.session_id = p_session_id; GET DIAGNOSTICS reclaimed_refresh_count = ROW_COUNT;
    DELETE FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id; GET DIAGNOSTICS reclaimed_session_count = ROW_COUNT;
    IF EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id) OR EXISTS (SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id = p_session_id) THEN RAISE EXCEPTION 'expired release lease reclamation verification failed' USING ERRCODE = '55000'; END IF;
    reclaimed_timestamp := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
    INSERT INTO public.release_auth_revocation_receipts (operation_id, user_id, session_id, binding_sha256, status, refresh_tokens_deleted, sessions_deleted, revoked_at) VALUES (lease.operation_id, lease.user_id, lease.session_id, lease.refresh_sha256, 'expired_reclaimed', reclaimed_refresh_count, reclaimed_session_count, reclaimed_timestamp);
    DELETE FROM public.release_auth_session_leases l WHERE l.operation_id = lease.operation_id AND l.user_id = lease.user_id AND l.session_id = lease.session_id;
    IF EXISTS (SELECT 1 FROM public.release_auth_session_leases l WHERE l.operation_id = lease.operation_id) THEN RAISE EXCEPTION 'expired release lease reclamation closure failed' USING ERRCODE = '55000'; END IF;
    RETURN pg_catalog.jsonb_build_object('schemaVersion', 2, 'status', 'expired_reclaimed', 'dedicatedIdentity', false, 'sessionBound', false, 'refreshBound', false, 'leaseActive', false, 'operationId', p_operation_id::text, 'expiresAt', p_expires_at);
  END IF;
  SELECT count(*) INTO enabled_count FROM public.release_auth_identities WHERE enabled;
  SELECT user_id INTO enabled_user_id FROM public.release_auth_identities WHERE enabled ORDER BY user_id LIMIT 1;
  IF enabled_count <> 1 OR enabled_user_id IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'dedicated release identity mismatch' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'release session binding mismatch' USING ERRCODE = 'P0002'; END IF;
  SELECT count(*) INTO matching_refresh_count FROM auth.refresh_tokens r WHERE r.session_id = p_session_id AND pg_catalog.encode(extensions.digest('tzudong:release-auth-refresh-binding:v1' || pg_catalog.chr(10) || r.token, 'sha256'), 'hex') = p_refresh_sha256;
  IF matching_refresh_count <> 1 THEN RAISE EXCEPTION 'release refresh binding mismatch' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.release_auth_session_leases (operation_id, user_id, session_id, refresh_sha256, expires_at) VALUES (p_operation_id, p_user_id, p_session_id, p_refresh_sha256, lease_expiry);
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 2, 'status', 'compatible_bound', 'dedicatedIdentity', true, 'sessionBound', true, 'refreshBound', true, 'leaseActive', true, 'operationId', p_operation_id::text, 'expiresAt', p_expires_at);
END;
$$;

CREATE FUNCTION public.revoke_release_auth_session_family(p_operation_id uuid, p_user_id uuid, p_session_id uuid, p_binding_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE existing public.release_auth_revocation_receipts%ROWTYPE; lease public.release_auth_session_leases%ROWTYPE; refresh_count bigint := 0; session_count integer := 0; revoked_timestamp timestamptz;
BEGIN
  IF COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF p_operation_id IS NULL OR p_user_id IS NULL OR p_session_id IS NULL OR p_binding_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'operation, bound identity, and public binding are required' USING ERRCODE = '22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_session_id::text, 0));
  SELECT * INTO existing FROM public.release_auth_revocation_receipts r WHERE r.operation_id = p_operation_id FOR UPDATE;
  IF FOUND THEN
    IF existing.user_id IS DISTINCT FROM p_user_id OR existing.session_id IS DISTINCT FROM p_session_id OR existing.binding_sha256 IS DISTINCT FROM p_binding_sha256 THEN RAISE EXCEPTION 'operation binding mismatch' USING ERRCODE = '23505'; END IF;
    IF EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id) OR EXISTS (SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id = p_session_id) OR EXISTS (SELECT 1 FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id) THEN RAISE EXCEPTION 'revocation readback mismatch' USING ERRCODE = '55000'; END IF;
    RETURN pg_catalog.jsonb_build_object('schemaVersion', 1, 'operationId', existing.operation_id::text, 'bindingSha256', existing.binding_sha256, 'status', existing.status, 'refreshTokensDeleted', existing.refresh_tokens_deleted, 'sessionsDeleted', existing.sessions_deleted, 'sessionAbsent', true, 'refreshTokensAbsent', true, 'revokedAt', pg_catalog.to_char(existing.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  SELECT * INTO lease FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND OR lease.user_id IS DISTINCT FROM p_user_id OR lease.session_id IS DISTINCT FROM p_session_id THEN RAISE EXCEPTION 'exact release lease is required' USING ERRCODE = 'P0002'; END IF;
  DELETE FROM auth.refresh_tokens r WHERE r.session_id = p_session_id; GET DIAGNOSTICS refresh_count = ROW_COUNT;
  DELETE FROM auth.sessions s WHERE s.id = p_session_id AND s.user_id = p_user_id; GET DIAGNOSTICS session_count = ROW_COUNT;
  IF session_count <> 1 OR EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id) OR EXISTS (SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id = p_session_id) THEN RAISE EXCEPTION 'revocation verification failed' USING ERRCODE = '55000'; END IF;
  revoked_timestamp := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  INSERT INTO public.release_auth_revocation_receipts (operation_id, user_id, session_id, binding_sha256, status, refresh_tokens_deleted, sessions_deleted, revoked_at) VALUES (p_operation_id, p_user_id, p_session_id, p_binding_sha256, 'revoked_verified', refresh_count, session_count, revoked_timestamp);
  DELETE FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id AND l.user_id = p_user_id AND l.session_id = p_session_id;
  IF EXISTS (SELECT 1 FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id) THEN RAISE EXCEPTION 'release lease closure failed' USING ERRCODE = '55000'; END IF;
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 1, 'operationId', p_operation_id::text, 'bindingSha256', p_binding_sha256, 'status', 'revoked_verified', 'refreshTokensDeleted', refresh_count, 'sessionsDeleted', session_count, 'sessionAbsent', true, 'refreshTokensAbsent', true, 'revokedAt', pg_catalog.to_char(revoked_timestamp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

CREATE FUNCTION public.read_release_auth_revocation(p_operation_id uuid, p_user_id uuid, p_session_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE receipt public.release_auth_revocation_receipts%ROWTYPE;
BEGIN
  IF COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF p_operation_id IS NULL OR p_user_id IS NULL OR p_session_id IS NULL THEN RAISE EXCEPTION 'operation and bound identity are required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO receipt FROM public.release_auth_revocation_receipts r WHERE r.operation_id = p_operation_id AND r.user_id = p_user_id AND r.session_id = p_session_id;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = p_session_id) OR EXISTS (SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id = p_session_id) OR EXISTS (SELECT 1 FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id) THEN RAISE EXCEPTION 'revocation receipt unavailable' USING ERRCODE = 'P0002'; END IF;
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 1, 'operationId', receipt.operation_id::text, 'bindingSha256', receipt.binding_sha256, 'status', receipt.status, 'refreshTokensDeleted', receipt.refresh_tokens_deleted, 'sessionsDeleted', receipt.sessions_deleted, 'sessionAbsent', true, 'refreshTokensAbsent', true, 'revokedAt', pg_catalog.to_char(receipt.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

CREATE FUNCTION public.read_release_auth_revocation_by_operation(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE receipt public.release_auth_revocation_receipts%ROWTYPE; claims jsonb;
BEGIN
  claims := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  IF COALESCE(claims ->> 'release_evidence_read', '') <> 'true' OR COALESCE(claims ->> 'role', '') NOT IN ('anon', 'authenticated') THEN RAISE EXCEPTION 'release evidence capability required' USING ERRCODE = '42501'; END IF;
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'operation is required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO receipt FROM public.release_auth_revocation_receipts r WHERE r.operation_id = p_operation_id;
  IF NOT FOUND OR EXISTS (SELECT 1 FROM auth.sessions s WHERE s.id = receipt.session_id) OR EXISTS (SELECT 1 FROM auth.refresh_tokens r WHERE r.session_id = receipt.session_id) OR EXISTS (SELECT 1 FROM public.release_auth_session_leases l WHERE l.operation_id = p_operation_id) THEN RAISE EXCEPTION 'revocation receipt unavailable' USING ERRCODE = 'P0002'; END IF;
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 1, 'operationId', receipt.operation_id::text, 'bindingSha256', receipt.binding_sha256, 'status', receipt.status, 'refreshTokensDeleted', receipt.refresh_tokens_deleted, 'sessionsDeleted', receipt.sessions_deleted, 'sessionAbsent', true, 'refreshTokensAbsent', true, 'revokedAt', pg_catalog.to_char(receipt.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END;
$$;

CREATE FUNCTION public.get_current_auth_session_id() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE jwt_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  BEGIN jwt_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END;
  IF jwt_session_id IS NULL THEN RETURN NULL; END IF;
  RETURN (SELECT s.id FROM auth.sessions s WHERE s.id = jwt_session_id AND s.user_id = auth.uid());
END;
$$;

CREATE FUNCTION public.is_current_auth_session_active() RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_session_id uuid; current_user_id uuid := auth.uid(); lease public.release_auth_session_leases%ROWTYPE;
BEGIN
  current_session_id := public.get_current_auth_session_id();
  IF current_session_id IS NULL OR current_user_id IS NULL THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.release_auth_identities i WHERE i.user_id = current_user_id) THEN RETURN true; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_session_id::text, 0));
  SELECT * INTO lease FROM public.release_auth_session_leases l WHERE l.user_id = current_user_id AND l.session_id = current_session_id FOR UPDATE;
  IF FOUND AND lease.expires_at > pg_catalog.clock_timestamp() THEN RETURN true; END IF;
  IF FOUND THEN
    DELETE FROM auth.refresh_tokens r WHERE r.session_id = current_session_id;
    DELETE FROM auth.sessions s WHERE s.id = current_session_id AND s.user_id = current_user_id;
    DELETE FROM public.release_auth_session_leases l WHERE l.operation_id = lease.operation_id;
  END IF;
  RETURN false;
END;
$$;

ALTER FUNCTION public.preflight_release_auth_session_family(uuid, uuid, uuid, text, bigint) OWNER TO postgres;
ALTER FUNCTION public.revoke_release_auth_session_family(uuid, uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.read_release_auth_revocation(uuid, uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.read_release_auth_revocation_by_operation(uuid) OWNER TO postgres;
ALTER FUNCTION public.get_current_auth_session_id() OWNER TO postgres;
ALTER FUNCTION public.is_current_auth_session_active() OWNER TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE ALL ON FUNCTION public.preflight_release_auth_session_family(uuid, uuid, uuid, text, bigint) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.revoke_release_auth_session_family(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_release_auth_revocation(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_release_auth_revocation_by_operation(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_current_auth_session_id() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_current_auth_session_active() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preflight_release_auth_session_family(uuid, uuid, uuid, text, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_release_auth_session_family(uuid, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_release_auth_revocation(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_release_auth_revocation_by_operation(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_auth_session_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_current_auth_session_active() TO authenticated;
NOTIFY pgrst, 'reload schema';
