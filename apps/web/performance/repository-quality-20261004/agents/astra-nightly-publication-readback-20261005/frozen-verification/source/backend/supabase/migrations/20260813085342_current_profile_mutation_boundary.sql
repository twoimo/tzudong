-- Harden signup initialization and expose bounded self-profile mutation RPCs.

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:current-profile-mutation-boundary:v1',
    0
  )
);

DO $lock_prerequisites$
BEGIN
  IF pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_stats') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL THEN
    RAISE EXCEPTION 'current_profile_mutation_lock_prerequisite_missing';
  END IF;
END
$lock_prerequisites$;

LOCK TABLE auth.users IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.profiles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.user_roles IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.user_stats IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.user_account_status IN ACCESS EXCLUSIVE MODE;

DO $prerequisites$
DECLARE
  v_nickname_attnum smallint;
  v_constraint record;
  v_definer_source_sha256 constant text :=
    'ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9';
  v_catalog_source_sha256 constant text :=
    'addca083161250234a8378713dbc07074bfff248f5d0f02f4a8f3772a5b951e6';
BEGIN
  IF pg_catalog.to_regrole('postgres') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regrole('supabase_auth_admin') IS NULL
     OR pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regclass('auth.users') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_stats') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL
     OR pg_catalog.to_regclass(
       'privacy_retention.g014_public_rpc_allowlist'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.handle_new_user()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.g041_current_claim_user_id()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.g014_privacy_eligibility_receipt(uuid)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.g014_require_service_role()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_public_rpc_allowlist()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_definer_contract()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_catalog_contract()'
     ) IS NULL THEN
    RAISE EXCEPTION 'current_profile_mutation_prerequisite_missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'update_current_profile_nickname',
         'compare_and_set_current_profile_avatar',
         'read_signup_profile_state'
       )
  ) OR EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.function_schema = 'public'
       AND allowed.function_name IN (
         'update_current_profile_nickname',
         'compare_and_set_current_profile_avatar',
         'read_signup_profile_state'
       )
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_identity_conflict';
  END IF;

  IF (
    SELECT pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
      'hex'
    )
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid =
       'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure
  ) IS DISTINCT FROM v_definer_source_sha256
     OR (
       SELECT pg_catalog.encode(
         pg_catalog.sha256(pg_catalog.convert_to(procedure.prosrc, 'UTF8')),
         'hex'
       )
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid =
          'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
     ) IS DISTINCT FROM v_catalog_source_sha256 THEN
    RAISE EXCEPTION 'current_profile_mutation_g014_source_drift';
  END IF;

  SELECT attribute.attnum
    INTO v_nickname_attnum
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = 'public.profiles'::pg_catalog.regclass
     AND attribute.attname = 'nickname'
     AND attribute.atttypid = 'text'::pg_catalog.regtype
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;

  SELECT
    constraint_row.contype,
    constraint_row.conkey,
    constraint_row.convalidated,
    constraint_row.condeferrable,
    constraint_row.condeferred,
    index_row.indisunique,
    index_row.indisvalid,
    index_row.indisready,
    index_row.indimmediate,
    index_row.indpred
    INTO v_constraint
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_index AS index_row
      ON index_row.indexrelid = constraint_row.conindid
   WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
     AND constraint_row.conname = 'profiles_nickname_key';

  IF v_nickname_attnum IS NULL
     OR v_constraint.contype IS DISTINCT FROM 'u'::"char"
     OR v_constraint.conkey IS DISTINCT FROM ARRAY[v_nickname_attnum]::smallint[]
     OR v_constraint.convalidated IS DISTINCT FROM true
     OR v_constraint.condeferrable IS DISTINCT FROM false
     OR v_constraint.condeferred IS DISTINCT FROM false
     OR v_constraint.indisunique IS DISTINCT FROM true
     OR v_constraint.indisvalid IS DISTINCT FROM true
     OR v_constraint.indisready IS DISTINCT FROM true
     OR v_constraint.indimmediate IS DISTINCT FROM true
     OR v_constraint.indpred IS NOT NULL
     OR pg_catalog.to_regclass('public.profiles_active_nickname_key') IS NOT NULL
     OR EXISTS (
       SELECT profile.nickname
         FROM public.profiles AS profile
        WHERE profile.nickname <> '탈퇴한 사용자'
        GROUP BY profile.nickname
       HAVING pg_catalog.count(*) <> 1
     ) THEN
    RAISE EXCEPTION 'current_profile_mutation_nickname_index_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
       AND constraint_row.conname = 'profiles_avatar_url_octet_length_check'
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_avatar_constraint_conflict';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.avatar_url IS NOT NULL
       AND pg_catalog.octet_length(profile.avatar_url) > 4096
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_avatar_reference_too_large';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM auth.users AS auth_user
     WHERE auth_user.deleted_at IS NULL
       AND (
         (SELECT pg_catalog.count(*)
            FROM public.user_account_status AS status_row
           WHERE status_row.user_id = auth_user.id) <> 1
         OR (
           (SELECT pg_catalog.count(*)
              FROM public.user_account_status AS active_status
             WHERE active_status.user_id = auth_user.id
               AND active_status.account_status = 'active'
               AND active_status.disabled_at IS NULL) = 1
           AND (
             (SELECT pg_catalog.count(*)
                FROM public.profiles AS profile
               WHERE profile.user_id = auth_user.id
                 AND profile.nickname IS NOT NULL
                 AND profile.nickname <> '탈퇴한 사용자') <> 1
             OR (SELECT pg_catalog.count(*)
                   FROM public.user_roles AS role_row
                  WHERE role_row.user_id = auth_user.id) < 1
             OR (SELECT pg_catalog.count(*)
                   FROM public.user_stats AS stats
                  WHERE stats.user_id = auth_user.id) <> 1
           )
         )
         OR (
           (SELECT pg_catalog.count(*)
              FROM public.user_account_status AS active_status
             WHERE active_status.user_id = auth_user.id
               AND active_status.account_status = 'active'
               AND active_status.disabled_at IS NULL) = 0
           AND (SELECT pg_catalog.count(*)
                  FROM public.user_account_status AS disabled_status
                 WHERE disabled_status.user_id = auth_user.id
                   AND disabled_status.account_status = 'disabled'
                   AND disabled_status.disabled_at IS NOT NULL) <> 1
         )
       )
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_active_identity_incomplete';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'DELETE') THEN
    RAISE EXCEPTION 'current_profile_mutation_profiles_acl_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
       AND NOT trigger_row.tgisinternal
       AND (
         trigger_row.tgname = 'on_auth_user_created'
         OR trigger_row.tgfoid =
           'public.handle_new_user()'::pg_catalog.regprocedure
       )
       AND (
         trigger_row.tgname IS DISTINCT FROM 'on_auth_user_created'
         OR trigger_row.tgfoid IS DISTINCT FROM
           'public.handle_new_user()'::pg_catalog.regprocedure
         OR trigger_row.tgtype IS DISTINCT FROM 5::smallint
         OR trigger_row.tgenabled IS DISTINCT FROM 'O'::"char"
         OR trigger_row.tgnargs IS DISTINCT FROM 0::smallint
         OR trigger_row.tgargs IS DISTINCT FROM '\x'::bytea
         OR trigger_row.tgqual IS NOT NULL
         OR trigger_row.tgconstraint <> 0
       )
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_auth_trigger_conflict';
  END IF;
END
$prerequisites$;

ALTER TABLE public.profiles
  DROP CONSTRAINT profiles_nickname_key;

CREATE UNIQUE INDEX profiles_active_nickname_key
  ON public.profiles USING btree (nickname)
  WHERE nickname <> '탈퇴한 사용자';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_avatar_url_octet_length_check
  CHECK (
    avatar_url IS NULL OR pg_catalog.octet_length(avatar_url) <= 4096
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $handle_new_user$
DECLARE
  v_prefixes constant text[] := ARRAY[
    '쯔동이', '먹방친구', '맛집탐험', '한입가득', '냠냠박사',
    '국밥친구', '야식친구', '맛집제자'
  ];
  v_nickname text;
  v_constraint_name text;
  v_inserted boolean := false;
  v_attempt integer;
BEGIN
  IF NEW.raw_user_meta_data IS NULL
     OR pg_catalog.jsonb_typeof(NEW.raw_user_meta_data) <> 'object' THEN
    RAISE EXCEPTION 'signup_nickname_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF COALESCE(NEW.raw_user_meta_data, '{}'::jsonb) ? 'nickname' THEN
    IF pg_catalog.jsonb_typeof(NEW.raw_user_meta_data -> 'nickname')
       <> 'string' THEN
      RAISE EXCEPTION 'signup_nickname_invalid'
        USING ERRCODE = '22023';
    END IF;
    v_nickname := NEW.raw_user_meta_data ->> 'nickname';
    IF v_nickname IS NULL
       OR v_nickname IS DISTINCT FROM pg_catalog.btrim(v_nickname)
       OR pg_catalog.char_length(v_nickname) NOT BETWEEN 2 AND 20
       OR pg_catalog.octet_length(v_nickname) > 80
       OR v_nickname ~ '[[:cntrl:]]'
       OR v_nickname = '탈퇴한 사용자' THEN
      RAISE EXCEPTION 'signup_nickname_invalid'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.profiles (user_id, nickname, email)
    VALUES (NEW.id, v_nickname, NEW.email);
  ELSE
    FOR v_attempt IN 1..16 LOOP
      v_nickname := v_prefixes[
        1 + pg_catalog.floor(
          pg_catalog.random() * pg_catalog.array_length(v_prefixes, 1)
        )::integer
      ] || '_' || pg_catalog.lpad(
        pg_catalog.floor(pg_catalog.random() * 1000000)::integer::text,
        6,
        '0'
      );

      BEGIN
        INSERT INTO public.profiles (user_id, nickname, email)
        VALUES (NEW.id, v_nickname, NEW.email);
        v_inserted := true;
      EXCEPTION
        WHEN unique_violation THEN
          GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
          IF v_constraint_name IS DISTINCT FROM
             'profiles_active_nickname_key' THEN
            RAISE;
          END IF;
      END;

      EXIT WHEN v_inserted;
    END LOOP;

    IF NOT v_inserted THEN
      v_nickname := '쯔동이_' || pg_catalog.substr(
        pg_catalog.replace(NEW.id::text, '-', ''),
        1,
        12
      );
      INSERT INTO public.profiles (user_id, nickname, email)
      VALUES (NEW.id, v_nickname, NEW.email);
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);

  INSERT INTO public.user_account_status (user_id, account_status)
  VALUES (NEW.id, 'active');

  IF (SELECT pg_catalog.count(*) FROM public.profiles AS profile
      WHERE profile.user_id = NEW.id) <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_roles AS role_row
         WHERE role_row.user_id = NEW.id
           AND role_row.role::text = 'user') <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_roles AS role_row
         WHERE role_row.user_id = NEW.id) <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_stats AS stats
         WHERE stats.user_id = NEW.id) <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_account_status AS status_row
         WHERE status_row.user_id = NEW.id
           AND status_row.account_status = 'active'
           AND status_row.disabled_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'signup_profile_initialization_incomplete'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$handle_new_user$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

DO $auth_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
       AND trigger_row.tgname = 'on_auth_user_created'
       AND NOT trigger_row.tgisinternal
  ) THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
  END IF;
END
$auth_trigger$;

DO $membership_acquire$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND NOT membership.admin_option
  ) INTO v_membership_exists;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND membership.admin_option
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_owner_membership_drift';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'pg_catalog.pg_auth_members'::pg_catalog.regclass
       AND attribute.attname = 'set_option'
       AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT membership.set_option '
      || 'FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = '
      || '''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
      INTO v_set_option;
  END IF;

  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(
      CASE
        WHEN v_supports_set_option
          THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE'
        ELSE 'GRANT privacy_workflow_owner TO %I'
      END,
      session_user
    );
    PERFORM pg_catalog.set_config(
      'g014_profile.remove_owner_membership', 'true', true
    );
    PERFORM pg_catalog.set_config(
      'g014_profile.restore_owner_set_false', 'false', true
    );
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE',
      session_user
    );
    PERFORM pg_catalog.set_config(
      'g014_profile.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'g014_profile.restore_owner_set_false', 'true', true
    );
  ELSE
    PERFORM pg_catalog.set_config(
      'g014_profile.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'g014_profile.restore_owner_set_false', 'false', true
    );
  END IF;
END
$membership_acquire$;

GRANT SELECT ON TABLE public.user_stats TO privacy_workflow_owner;
DROP POLICY IF EXISTS g014_privacy_workflow_owner_access
  ON public.user_stats;
CREATE POLICY g014_privacy_workflow_owner_access
  ON public.user_stats
  FOR SELECT TO privacy_workflow_owner
  USING (true);

SET LOCAL ROLE privacy_workflow_owner;

CREATE FUNCTION public.update_current_profile_nickname(
  p_nickname text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $update_nickname$
DECLARE
  v_user_id uuid;
  v_current_nickname text;
  v_avatar_reference text;
  v_eligibility jsonb;
  v_constraint_name text;
  v_status text;
  v_reason_code text;
  v_changed boolean;
  v_rows integer;
BEGIN
  v_user_id := privacy_retention.g041_current_claim_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'profile_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM status_row.user_id
    FROM public.user_account_status AS status_row
   WHERE status_row.user_id = v_user_id
     AND status_row.account_status = 'active'
     AND status_row.disabled_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_account_inactive'
      USING ERRCODE = '42501';
  END IF;

  v_eligibility :=
    privacy_retention.g014_privacy_eligibility_receipt(v_user_id);
  IF COALESCE((v_eligibility ->> 'eligible')::boolean, false)
     IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile_privacy_ineligible'
      USING ERRCODE = '42501';
  END IF;

  IF p_nickname IS NULL
     OR p_nickname IS DISTINCT FROM pg_catalog.btrim(p_nickname)
     OR pg_catalog.char_length(p_nickname) NOT BETWEEN 2 AND 20
     OR pg_catalog.octet_length(p_nickname) > 80
     OR p_nickname ~ '[[:cntrl:]]'
     OR p_nickname = '탈퇴한 사용자' THEN
    RAISE EXCEPTION 'profile_nickname_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.nickname, profile.avatar_url
    INTO v_current_nickname, v_avatar_reference
    FROM public.profiles AS profile
   WHERE profile.user_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_current_nickname = '탈퇴한 사용자' THEN
    RAISE EXCEPTION 'profile_account_deleted'
      USING ERRCODE = '42501';
  END IF;

  IF v_current_nickname IS NOT DISTINCT FROM p_nickname THEN
    v_status := 'unchanged';
    v_reason_code := 'PROFILE_NICKNAME_UNCHANGED';
    v_changed := false;
  ELSE
    BEGIN
      UPDATE public.profiles AS profile
         SET nickname = p_nickname,
             updated_at = pg_catalog.clock_timestamp()
       WHERE profile.user_id = v_user_id;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
    EXCEPTION
      WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
        IF v_constraint_name IS DISTINCT FROM
           'profiles_active_nickname_key' THEN
          RAISE;
        END IF;
        RAISE EXCEPTION 'profile_nickname_unavailable'
          USING ERRCODE = '23505';
    END;
    IF v_rows IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'profile_nickname_readback_failed'
        USING ERRCODE = '55000';
    END IF;
    SELECT profile.nickname, profile.avatar_url
      INTO v_current_nickname, v_avatar_reference
      FROM public.profiles AS profile
     WHERE profile.user_id = v_user_id;
    IF NOT FOUND
       OR v_current_nickname IS DISTINCT FROM p_nickname
       OR v_current_nickname = '탈퇴한 사용자' THEN
      RAISE EXCEPTION 'profile_nickname_readback_failed'
        USING ERRCODE = '55000';
    END IF;
    v_status := 'applied';
    v_reason_code := 'PROFILE_NICKNAME_UPDATED';
    v_changed := true;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', v_status,
    'reasonCode', v_reason_code,
    'profile', pg_catalog.jsonb_build_object(
      'userId', v_user_id::text,
      'nickname', v_current_nickname,
      'avatarReference', v_avatar_reference
    ),
    'changes', pg_catalog.jsonb_build_object('nickname', v_changed),
    'readback', pg_catalog.jsonb_build_object('passed', true)
  );
END
$update_nickname$;

CREATE FUNCTION public.compare_and_set_current_profile_avatar(
  p_expected_avatar_reference text,
  p_next_avatar_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $compare_and_set_avatar$
DECLARE
  v_user_id uuid;
  v_nickname text;
  v_current_reference text;
  v_next_reference text;
  v_eligibility jsonb;
  v_status text;
  v_reason_code text;
  v_changed boolean;
  v_rows integer;
BEGIN
  v_user_id := privacy_retention.g041_current_claim_user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'profile_authentication_required'
      USING ERRCODE = '42501';
  END IF;

  PERFORM status_row.user_id
    FROM public.user_account_status AS status_row
   WHERE status_row.user_id = v_user_id
     AND status_row.account_status = 'active'
     AND status_row.disabled_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_account_inactive'
      USING ERRCODE = '42501';
  END IF;

  v_eligibility :=
    privacy_retention.g014_privacy_eligibility_receipt(v_user_id);
  IF COALESCE((v_eligibility ->> 'eligible')::boolean, false)
     IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'profile_privacy_ineligible'
      USING ERRCODE = '42501';
  END IF;

  IF p_expected_avatar_reference IS NOT NULL
     AND pg_catalog.octet_length(p_expected_avatar_reference) > 4096 THEN
    RAISE EXCEPTION 'profile_avatar_expected_reference_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT profile.nickname, profile.avatar_url
    INTO v_nickname, v_current_reference
    FROM public.profiles AS profile
   WHERE profile.user_id = v_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_nickname = '탈퇴한 사용자' THEN
    RAISE EXCEPTION 'profile_account_deleted'
      USING ERRCODE = '42501';
  END IF;

  IF v_current_reference IS DISTINCT FROM p_expected_avatar_reference THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'conflict',
      'reasonCode', 'PROFILE_VERSION_CONFLICT',
      'profile', pg_catalog.jsonb_build_object(
        'userId', v_user_id::text,
        'nickname', v_nickname,
        'avatarReference', v_current_reference
      ),
      'changes', pg_catalog.jsonb_build_object('avatar', false),
      'readback', pg_catalog.jsonb_build_object('passed', true)
    );
  END IF;

  v_next_reference := CASE
    WHEN p_next_avatar_operation_id IS NULL THEN NULL
    ELSE 'profile-avatar://' || v_user_id::text || '/avatar-'
      || pg_catalog.lower(p_next_avatar_operation_id::text) || '.jpg'
  END;

  IF v_current_reference IS NOT DISTINCT FROM v_next_reference THEN
    v_status := 'unchanged';
    v_reason_code := 'PROFILE_AVATAR_UNCHANGED';
    v_changed := false;
  ELSE
    UPDATE public.profiles AS profile
       SET avatar_url = v_next_reference,
           updated_at = pg_catalog.clock_timestamp()
     WHERE profile.user_id = v_user_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'profile_avatar_readback_failed'
        USING ERRCODE = '55000';
    END IF;
    SELECT profile.nickname, profile.avatar_url
      INTO v_nickname, v_current_reference
      FROM public.profiles AS profile
     WHERE profile.user_id = v_user_id;
    IF NOT FOUND
       OR v_nickname = '탈퇴한 사용자'
       OR v_current_reference IS DISTINCT FROM v_next_reference THEN
      RAISE EXCEPTION 'profile_avatar_readback_failed'
        USING ERRCODE = '55000';
    END IF;
    v_status := 'applied';
    v_reason_code := 'PROFILE_AVATAR_UPDATED';
    v_changed := true;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', v_status,
    'reasonCode', v_reason_code,
    'profile', pg_catalog.jsonb_build_object(
      'userId', v_user_id::text,
      'nickname', v_nickname,
      'avatarReference', v_current_reference
    ),
    'changes', pg_catalog.jsonb_build_object('avatar', v_changed),
    'readback', pg_catalog.jsonb_build_object('passed', true)
  );
END
$compare_and_set_avatar$;

CREATE FUNCTION public.read_signup_profile_state(
  p_user_id uuid,
  p_expected_nickname text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $read_signup_state$
DECLARE
  v_profile_count integer;
  v_ordinary_role_count integer;
  v_admin_role_count integer;
  v_stats_count integer;
  v_active_status_count integer;
  v_nickname_matches boolean;
  v_complete boolean;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();

  IF p_user_id IS NULL
     OR p_expected_nickname IS NULL
     OR p_expected_nickname IS DISTINCT FROM
       pg_catalog.btrim(p_expected_nickname)
     OR pg_catalog.char_length(p_expected_nickname) NOT BETWEEN 2 AND 20
     OR pg_catalog.octet_length(p_expected_nickname) > 80
     OR p_expected_nickname ~ '[[:cntrl:]]'
     OR p_expected_nickname = '탈퇴한 사용자' THEN
    RAISE EXCEPTION 'signup_profile_state_request_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (
           WHERE profile.nickname = p_expected_nickname
         ) = 1
    INTO v_profile_count, v_nickname_matches
    FROM public.profiles AS profile
   WHERE profile.user_id = p_user_id;

  SELECT pg_catalog.count(*)::integer
    INTO v_ordinary_role_count
    FROM public.user_roles AS role_row
   WHERE role_row.user_id = p_user_id
     AND role_row.role::text = 'user';

  SELECT pg_catalog.count(*)::integer
    INTO v_admin_role_count
    FROM public.user_roles AS role_row
   WHERE role_row.user_id = p_user_id
     AND role_row.role::text = 'admin';

  SELECT pg_catalog.count(*)::integer
    INTO v_stats_count
    FROM public.user_stats AS stats
   WHERE stats.user_id = p_user_id;

  SELECT pg_catalog.count(*)::integer
    INTO v_active_status_count
    FROM public.user_account_status AS status_row
   WHERE status_row.user_id = p_user_id
     AND status_row.account_status = 'active'
     AND status_row.disabled_at IS NULL;

  v_complete := v_profile_count = 1
    AND v_nickname_matches
    AND v_ordinary_role_count = 1
    AND v_admin_role_count = 0
    AND v_stats_count = 1
    AND v_active_status_count = 1;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'complete', v_complete,
    'reasonCode', CASE
      WHEN v_complete THEN 'SIGNUP_PROFILE_READY'
      ELSE 'SIGNUP_PROFILE_INCOMPLETE'
    END,
    'nicknameMatches', v_nickname_matches,
    'counts', pg_catalog.jsonb_build_object(
      'profile', v_profile_count,
      'ordinaryRole', v_ordinary_role_count,
      'adminRole', v_admin_role_count,
      'stats', v_stats_count,
      'activeStatus', v_active_status_count
    )
  );
END
$read_signup_state$;

REVOKE ALL ON FUNCTION public.update_current_profile_nickname(text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.compare_and_set_current_profile_avatar(text, uuid)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.read_signup_profile_state(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.update_current_profile_nickname(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.compare_and_set_current_profile_avatar(text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.read_signup_profile_state(uuid, text)
  TO service_role;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  signature.grantee,
  signature.source_signature
  FROM (VALUES
    (
      'public.update_current_profile_nickname(text)'::text,
      'authenticated'::name
    ),
    (
      'public.compare_and_set_current_profile_avatar(text,uuid)'::text,
      'authenticated'::name
    ),
    (
      'public.read_signup_profile_state(uuid,text)'::text,
      'service_role'::name
    )
  ) AS signature(source_signature, grantee)
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid =
      pg_catalog.to_regprocedure(signature.source_signature)
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace;

DO $definer_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    'ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9';
  v_expected_source_sha256_after constant text :=
    '6cce195e7d21002c3807f32528b3c8f99cd86fffb08f1cda5785143bb803e10d';
  v_anchor constant text := $definer_anchor$    IF v_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)',
      'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_signature;
    END IF;
$definer_anchor$;
  v_replacement constant text := $definer_replacement$    IF v_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)',
      'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)',
      'public.update_current_profile_nickname(text)',
      'public.compare_and_set_current_profile_avatar(text,uuid)',
      'public.read_signup_profile_state(uuid,text)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 profile boundary became SECURITY INVOKER: %',
        v_signature;
    END IF;
$definer_replacement$;
  v_definition text;
  v_source text;
  v_source_after text;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_returns_set boolean;
  v_return_type oid;
  v_language oid;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    procedure.prosrc,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.provolatile,
    procedure.prokind,
    procedure.proretset,
    procedure.prorettype,
    procedure.prolang
    INTO
      v_definition,
      v_source,
      v_owner,
      v_acl,
      v_security_definer,
      v_config,
      v_volatility,
      v_kind,
      v_returns_set,
      v_return_type,
      v_language
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner =
       'privacy_workflow_owner'::pg_catalog.regrole
     AND procedure.prosecdef
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[];

  IF v_definition IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_before
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, ''))
     ) / pg_catalog.length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'current_profile_mutation_definer_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);

  SELECT procedure.prosrc
    INTO v_source_after
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner = v_owner
     AND procedure.proacl IS NOT DISTINCT FROM v_acl
     AND procedure.prosecdef IS NOT DISTINCT FROM v_security_definer
     AND procedure.proconfig IS NOT DISTINCT FROM v_config
     AND procedure.provolatile IS NOT DISTINCT FROM v_volatility
     AND procedure.prokind IS NOT DISTINCT FROM v_kind
     AND procedure.proretset IS NOT DISTINCT FROM v_returns_set
     AND procedure.prorettype IS NOT DISTINCT FROM v_return_type
     AND procedure.prolang IS NOT DISTINCT FROM v_language;

  IF v_source_after IS NULL
     OR v_source_after IS NOT DISTINCT FROM v_source
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source_after, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_after
     OR pg_catalog.strpos(v_source_after, v_anchor) <> 0
     OR (
       pg_catalog.length(v_source_after)
       - pg_catalog.length(
         pg_catalog.replace(v_source_after, v_replacement, '')
       )
     ) / pg_catalog.length(v_replacement) <> 1 THEN
    RAISE EXCEPTION 'current_profile_mutation_definer_readback_drift';
  END IF;
END
$definer_contract$;

DO $catalog_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    'addca083161250234a8378713dbc07074bfff248f5d0f02f4a8f3772a5b951e6';
  v_expected_source_sha256_after constant text :=
    'c58fa9c66865db3f5e81513f9537084a9024ebe77863a1b22f4ddb37936c6998';
  v_definer_anchor constant text := $catalog_definer_anchor$    IF v_expected.source_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)',
      'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_expected.source_signature;
    END IF;
$catalog_definer_anchor$;
  v_definer_replacement constant text := $catalog_definer_replacement$    IF v_expected.source_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)',
      'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)',
      'public.update_current_profile_nickname(text)',
      'public.compare_and_set_current_profile_avatar(text,uuid)',
      'public.read_signup_profile_state(uuid,text)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 profile boundary became SECURITY INVOKER: %',
        v_expected.source_signature;
    END IF;
$catalog_definer_replacement$;
  v_matrix_anchor constant text := $catalog_matrix_anchor$    WITH expected(source_signature, grantee) AS (
      VALUES
        ('public.get_current_privacy_policy_version()', 'authenticated'::name),
$catalog_matrix_anchor$;
  v_matrix_replacement constant text := $catalog_matrix_replacement$    WITH expected(source_signature, grantee) AS (
      VALUES
        ('public.update_current_profile_nickname(text)', 'authenticated'::name),
        ('public.compare_and_set_current_profile_avatar(text,uuid)', 'authenticated'::name),
        ('public.read_signup_profile_state(uuid,text)', 'service_role'::name),
        ('public.get_current_privacy_policy_version()', 'authenticated'::name),
$catalog_matrix_replacement$;
  v_definition text;
  v_source text;
  v_source_after text;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_returns_set boolean;
  v_return_type oid;
  v_language oid;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    procedure.prosrc,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.provolatile,
    procedure.prokind,
    procedure.proretset,
    procedure.prorettype,
    procedure.prolang
    INTO
      v_definition,
      v_source,
      v_owner,
      v_acl,
      v_security_definer,
      v_config,
      v_volatility,
      v_kind,
      v_returns_set,
      v_return_type,
      v_language
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner =
       'privacy_workflow_owner'::pg_catalog.regrole
     AND procedure.prosecdef
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[];

  IF v_definition IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_before
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(
         pg_catalog.replace(v_source, v_definer_anchor, '')
       )
     ) / pg_catalog.length(v_definer_anchor) <> 1
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(
         pg_catalog.replace(v_source, v_matrix_anchor, '')
       )
     ) / pg_catalog.length(v_matrix_anchor) <> 1 THEN
    RAISE EXCEPTION 'current_profile_mutation_catalog_source_drift';
  END IF;

  v_definition := pg_catalog.replace(
    v_definition,
    v_definer_anchor,
    v_definer_replacement
  );
  v_definition := pg_catalog.replace(
    v_definition,
    v_matrix_anchor,
    v_matrix_replacement
  );
  EXECUTE v_definition;

  SELECT procedure.prosrc
    INTO v_source_after
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner = v_owner
     AND procedure.proacl IS NOT DISTINCT FROM v_acl
     AND procedure.prosecdef IS NOT DISTINCT FROM v_security_definer
     AND procedure.proconfig IS NOT DISTINCT FROM v_config
     AND procedure.provolatile IS NOT DISTINCT FROM v_volatility
     AND procedure.prokind IS NOT DISTINCT FROM v_kind
     AND procedure.proretset IS NOT DISTINCT FROM v_returns_set
     AND procedure.prorettype IS NOT DISTINCT FROM v_return_type
     AND procedure.prolang IS NOT DISTINCT FROM v_language;

  IF v_source_after IS NULL
     OR v_source_after IS NOT DISTINCT FROM v_source
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source_after, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_after
     OR pg_catalog.strpos(v_source_after, v_definer_anchor) <> 0
     OR pg_catalog.strpos(v_source_after, v_matrix_anchor) <> 0
     OR (
       pg_catalog.length(v_source_after)
       - pg_catalog.length(
         pg_catalog.replace(v_source_after, v_definer_replacement, '')
       )
     ) / pg_catalog.length(v_definer_replacement) <> 1
     OR (
       pg_catalog.length(v_source_after)
       - pg_catalog.length(
         pg_catalog.replace(v_source_after, v_matrix_replacement, '')
       )
     ) / pg_catalog.length(v_matrix_replacement) <> 1 THEN
    RAISE EXCEPTION 'current_profile_mutation_catalog_readback_drift';
  END IF;
END
$catalog_contract$;

DO $contract_readback$
DECLARE
  v_nickname oid := pg_catalog.to_regprocedure(
    'public.update_current_profile_nickname(text)'
  );
  v_avatar oid := pg_catalog.to_regprocedure(
    'public.compare_and_set_current_profile_avatar(text,uuid)'
  );
  v_signup oid := pg_catalog.to_regprocedure(
    'public.read_signup_profile_state(uuid,text)'
  );
  v_handle oid := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_auth_users_oid oid;
  v_nickname_attnum smallint;
BEGIN
  SELECT relation_row.oid
    INTO v_auth_users_oid
    FROM pg_catalog.pg_class AS relation_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation_row.relnamespace
   WHERE namespace.nspname = 'auth'
     AND relation_row.relname = 'users'
     AND relation_row.relkind = 'r';

  IF v_nickname IS NULL OR v_avatar IS NULL OR v_signup IS NULL
     OR v_handle IS NULL OR v_auth_users_oid IS NULL
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'update_current_profile_nickname',
            'compare_and_set_current_profile_avatar',
            'read_signup_profile_state'
          )
     ) <> 3
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid IN (v_nickname, v_avatar, v_signup)
          AND (
            procedure.proowner IS DISTINCT FROM
              'privacy_workflow_owner'::pg_catalog.regrole
            OR procedure.prorettype IS DISTINCT FROM
              'jsonb'::pg_catalog.regtype
            OR procedure.proretset
            OR procedure.prokind IS DISTINCT FROM 'f'::"char"
            OR procedure.prosecdef IS DISTINCT FROM true
            OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
            OR procedure.prolang IS DISTINCT FROM (
              SELECT language.oid
                FROM pg_catalog.pg_language AS language
               WHERE language.lanname = 'plpgsql'
            )
            OR (
              procedure.oid IN (v_nickname, v_avatar)
              AND procedure.provolatile IS DISTINCT FROM 'v'::"char"
            )
            OR (
              procedure.oid = v_signup
              AND procedure.provolatile IS DISTINCT FROM 's'::"char"
            )
          )
     ) THEN
    RAISE EXCEPTION 'current_profile_mutation_function_metadata_drift';
  END IF;

  IF (
    SELECT procedure.proargnames
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_nickname
  ) IS DISTINCT FROM ARRAY['p_nickname']::text[]
     OR (
       SELECT procedure.proargnames
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_avatar
     ) IS DISTINCT FROM ARRAY[
       'p_expected_avatar_reference', 'p_next_avatar_operation_id'
     ]::text[]
     OR (
       SELECT procedure.proargnames
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_signup
     ) IS DISTINCT FROM ARRAY['p_user_id', 'p_expected_nickname']::text[] THEN
    RAISE EXCEPTION 'current_profile_mutation_argument_shape_drift';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'authenticated', v_nickname, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', v_avatar, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', v_signup, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', v_nickname, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_nickname, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_avatar, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_avatar, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_signup, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_signup, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'supabase_auth_admin', v_nickname, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'supabase_auth_admin', v_avatar, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'supabase_auth_admin', v_signup, 'EXECUTE'
     )
     OR (
       SELECT pg_catalog.count(*)
         FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature IN (
          'public.update_current_profile_nickname(text)',
          'public.compare_and_set_current_profile_avatar(text,uuid)',
          'public.read_signup_profile_state(uuid,text)'
        )
          AND allowed.identity_arguments = (
            SELECT procedure.proargtypes::text
              FROM pg_catalog.pg_proc AS procedure
             WHERE procedure.oid =
               pg_catalog.to_regprocedure(allowed.source_signature)
          )
     ) <> 3 THEN
    RAISE EXCEPTION 'current_profile_mutation_function_acl_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_handle
       AND (
         procedure.proowner IS DISTINCT FROM 'postgres'::pg_catalog.regrole
         OR procedure.prorettype IS DISTINCT FROM
           'trigger'::pg_catalog.regtype
         OR procedure.prosecdef IS DISTINCT FROM true
         OR procedure.proconfig IS DISTINCT FROM
           ARRAY['search_path=""']::text[]
         OR procedure.provolatile IS DISTINCT FROM 'v'::"char"
         OR pg_catalog.strpos(procedure.prosrc, 'WHEN OTHERS') <> 0
         OR pg_catalog.strpos(procedure.prosrc, 'SQLERRM') <> 0
       )
  )
     OR pg_catalog.has_function_privilege('anon', v_handle, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_handle, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_handle, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'supabase_auth_admin', v_handle, 'EXECUTE'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid = v_auth_users_oid
          AND trigger_row.tgname = 'on_auth_user_created'
          AND trigger_row.tgfoid = v_handle
          AND trigger_row.tgtype = 5::smallint
          AND trigger_row.tgenabled = 'O'::"char"
          AND trigger_row.tgnargs = 0
          AND trigger_row.tgargs = '\x'::bytea
          AND trigger_row.tgqual IS NULL
          AND trigger_row.tgconstraint = 0
          AND NOT trigger_row.tgisinternal
     ) THEN
    RAISE EXCEPTION 'current_profile_mutation_auth_trigger_drift';
  END IF;

  SELECT attribute.attnum
    INTO v_nickname_attnum
    FROM pg_catalog.pg_attribute AS attribute
   WHERE attribute.attrelid = 'public.profiles'::pg_catalog.regclass
     AND attribute.attname = 'nickname'
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped;

  IF pg_catalog.to_regclass('public.profiles_nickname_key') IS NOT NULL
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_index AS index_row
        WHERE index_row.indexrelid =
          'public.profiles_active_nickname_key'::pg_catalog.regclass
          AND index_row.indrelid = 'public.profiles'::pg_catalog.regclass
          AND index_row.indisunique
          AND index_row.indisvalid
          AND index_row.indisready
          AND index_row.indimmediate
          AND index_row.indnkeyatts = 1
          AND index_row.indnatts = 1
          AND (index_row.indkey::smallint[])[0] = v_nickname_attnum
          AND pg_catalog.pg_get_expr(
            index_row.indpred, index_row.indrelid, false
          ) = '(nickname <> ''탈퇴한 사용자''::text)'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
          AND constraint_row.conname IN (
            'profiles_nickname_key', 'profiles_active_nickname_key'
          )
     ) THEN
    RAISE EXCEPTION 'current_profile_mutation_nickname_index_readback_drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.profiles'::pg_catalog.regclass
       AND constraint_row.conname = 'profiles_avatar_url_octet_length_check'
       AND constraint_row.contype = 'c'::"char"
       AND constraint_row.convalidated
       AND NOT constraint_row.condeferrable
       AND NOT constraint_row.condeferred
       AND constraint_row.conislocal
       AND constraint_row.coninhcount = 0
       AND NOT constraint_row.connoinherit
       AND pg_catalog.pg_get_expr(
         constraint_row.conbin, constraint_row.conrelid, false
       ) = '((avatar_url IS NULL) OR (octet_length(avatar_url) <= 4096))'
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_avatar_constraint_readback_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.avatar_url IS NOT NULL
       AND pg_catalog.octet_length(profile.avatar_url) > 4096
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_avatar_reference_readback_drift';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'DELETE') THEN
    RAISE EXCEPTION 'current_profile_mutation_profiles_acl_readback_drift';
  END IF;
END
$contract_readback$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();

CREATE TEMPORARY TABLE g014_profile_catalog_assertion_guard (
  asserted boolean NOT NULL CHECK (asserted)
) ON COMMIT DROP;

REVOKE ALL ON TABLE pg_temp.g014_profile_catalog_assertion_guard
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;

CREATE FUNCTION pg_temp.g014_profile_catalog_assertion_bridge()
RETURNS pg_temp.g014_profile_catalog_assertion_guard
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
DECLARE
  v_result pg_temp.g014_profile_catalog_assertion_guard;
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_contract();
  v_result.asserted := true;
  RETURN v_result;
END
$bridge$;

REVOKE ALL ON FUNCTION pg_temp.g014_profile_catalog_assertion_bridge()
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;

DO $grant_bridge_execute$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION '
    || 'pg_temp.g014_profile_catalog_assertion_bridge() TO %I',
    session_user
  );
END
$grant_bridge_execute$;

RESET ROLE;

DO $active_identity_readback$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM auth.users AS auth_user
     WHERE auth_user.deleted_at IS NULL
       AND (
         (SELECT pg_catalog.count(*)
            FROM public.user_account_status AS status_row
           WHERE status_row.user_id = auth_user.id) <> 1
         OR (
           (SELECT pg_catalog.count(*)
              FROM public.user_account_status AS active_status
             WHERE active_status.user_id = auth_user.id
               AND active_status.account_status = 'active'
               AND active_status.disabled_at IS NULL) = 1
           AND (
             (SELECT pg_catalog.count(*)
                FROM public.profiles AS profile
               WHERE profile.user_id = auth_user.id
                 AND profile.nickname IS NOT NULL
                 AND profile.nickname <> '탈퇴한 사용자') <> 1
             OR (SELECT pg_catalog.count(*)
                   FROM public.user_roles AS role_row
                  WHERE role_row.user_id = auth_user.id) < 1
             OR (SELECT pg_catalog.count(*)
                   FROM public.user_stats AS stats
                  WHERE stats.user_id = auth_user.id) <> 1
           )
         )
         OR (
           (SELECT pg_catalog.count(*)
              FROM public.user_account_status AS active_status
             WHERE active_status.user_id = auth_user.id
               AND active_status.account_status = 'active'
               AND active_status.disabled_at IS NULL) = 0
           AND (SELECT pg_catalog.count(*)
                  FROM public.user_account_status AS disabled_status
                 WHERE disabled_status.user_id = auth_user.id
                   AND disabled_status.account_status = 'disabled'
                   AND disabled_status.disabled_at IS NOT NULL) <> 1
         )
       )
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_active_identity_readback_incomplete';
  END IF;
END
$active_identity_readback$;

DO $membership_restore$
BEGIN
  IF pg_catalog.current_setting(
    'g014_profile.restore_owner_set_false',
    true
  ) = 'true' THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE',
      session_user
    );
  ELSIF pg_catalog.current_setting(
    'g014_profile.remove_owner_membership',
    true
  ) = 'true' THEN
    EXECUTE pg_catalog.format(
      'REVOKE privacy_workflow_owner FROM %I',
      session_user
    );
  END IF;
END
$membership_restore$;

DO $membership_postcondition$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
  v_remove boolean := pg_catalog.current_setting(
    'g014_profile.remove_owner_membership',
    true
  ) = 'true';
  v_restore_set_false boolean := pg_catalog.current_setting(
    'g014_profile.restore_owner_set_false',
    true
  ) = 'true';
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND NOT membership.admin_option
  ) INTO v_membership_exists;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND membership.admin_option
  ) THEN
    RAISE EXCEPTION 'current_profile_mutation_owner_membership_cleanup_drift';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'pg_catalog.pg_auth_members'::pg_catalog.regclass
       AND attribute.attname = 'set_option'
       AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT membership.set_option '
      || 'FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = '
      || '''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
      INTO v_set_option;
  END IF;

  IF (v_remove AND v_membership_exists)
     OR (NOT v_remove AND NOT v_membership_exists)
     OR (
       NOT v_remove
       AND v_supports_set_option
       AND v_set_option IS DISTINCT FROM (NOT v_restore_set_false)
     ) THEN
    RAISE EXCEPTION 'current_profile_mutation_owner_membership_cleanup_drift';
  END IF;
END
$membership_postcondition$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();

DO $catalog_assertion_readback$
DECLARE
  v_asserted boolean;
BEGIN
  SELECT (pg_temp.g014_profile_catalog_assertion_bridge()).asserted
    INTO v_asserted;
  IF v_asserted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'current_profile_mutation_catalog_assertion_failed';
  END IF;
END
$catalog_assertion_readback$;

NOTIFY pgrst, 'reload schema';

COMMIT;
